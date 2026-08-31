# JackDevOps 架构设计

> 功能定义见 `feature-inventory.md`，本文档回答"怎么实现"。

---

## 1. 技术栈定案

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript 5.x，Node 22 LTS | 与 dsh 同栈；全栈统一 |
| 后端 | NestJS（模块化单体） | 生态成熟，模块边界清晰，向微服务演进留有余地 |
| 数据 | PostgreSQL + Drizzle ORM | 单库起步；类型安全、SQL 友好；避免 Zadig 双库复杂度 |
| 队列/执行 | BullMQ（Redis）+ 独立 Runner 进程 | 对标 Zadig 的 Aslan + job-executor 模式 |
| 前端 | React + Vite + TanStack Query + shadcn/ui + React Flow | 开发者审美、暗色优先；React Flow 支撑 DAG 编辑器 |
| AI | @deepseek-ai/dsh（零分叉融合） | 见 §5 |
| 交付 | Helm Chart + Docker Compose | 企业与小团队双形态（F10） |
| 工程化 | pnpm workspaces + Turborepo | monorepo，包间依赖清晰 |

---

## 2. 分层架构

```
┌─────────────────────────────────────────────────────────┐
│ 接入层   Web 控制台 (React)  │ CLI  │ IDE 插件  │ 开放 API │
├─────────────────────────────────────────────────────────┤
│ 体验层   ⌘K 命令面板（F11）│ 角色化工作台（A3）          │
├─────────────────────────────────────────────────────────┤
│ 业务层   需求/工作项(A1)  服务目录(A2)  测试管理(C1)       │
│          工作流引擎(D1)   环境管理(D3)  发布编排(D4/D5)    │
├─────────────────────────────────────────────────────────┤
│ AI 层    agent-gateway（边界）                            │
│            └ dsh Runtime：ctx.llm / ctx.tools / ctx.jobs │
├─────────────────────────────────────────────────────────┤
│ 平台层   事件溯源+F1 变更指纹  RBAC/SSO(F2)  审计(F3)      │
│          插件机制(Job)  DORA 度量(F6)                      │
├─────────────────────────────────────────────────────────┤
│ 集成层   GitHub/GitLab(B1)  镜像仓库  K8s 多集群           │
│         Trivy(C3)  Prometheus/Grafana  IM(钉钉/企微/飞书)  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 领域模型：以服务目录为轴心（A2）

**原则：一切实体都是目录中的实体。**

```
Service（服务）── 项目/仓库/语言/负责人/文档（TechDocs P3）
   │              健康分、当前告警、近期变更
   ├─ Environment（环境）    dev / staging / prod …，一套服务配置派生多环境
   ├─ Pipeline（流水线）     由 WorkflowTemplate 实例化
   ├─ WorkItem（需求/任务/缺陷）
   ├─ Release（发布）        版本、关联物清单、审批状态
   └─ Incident（事故）       关联告警与变更
```

设计要点：
- 服务、环境、流水线、需求、发布全部挂目录树，统一 RBAC 与审计入口
- 依赖图是 A2 的一等数据，支撑 C4 智能测试选择与 D5 关联物回滚

---

## 4. 事件溯源与变更指纹（F1，差异化地基）

### 4.1 设计原则

1. **不可变事件流**：全生命周期事实（需求创建/PR 合并/构建完成/制品生成/发布/告警）均为 append-only 事件，禁止 UPDATE
2. **变更指纹（change traceId）**：每个需求/PR 生成 traceId，贯穿其产生的所有构建、制品、发布、告警事件；任何事件可展开完整因果链
3. **投影（Projection）**：看板/状态页/看板报表全部从事件流投影生成，杜绝"第二事实源"
4. **AI 上下文**：事件流是 dsh Agent 的上下文源（E5）

### 4.2 事件 Schema 示意

```jsonc
{
  "eventId": "evt_01J...",
  "traceId": "chg_01J...",          // 变更指纹
  "type": "deployment.succeeded",    // 领域事件类型
  "aggregate": { "type": "release", "id": "rel_01J..." },
  "actor": { "type": "user" | "agent" | "system", "id": "..." },
  "payload": { /* 领域负载 */ },
  "occurredAt": "2026-08-31T00:00:00Z"
}
```

> 事件类型命名空间：`workitem.*` / `pipeline.*` / `build.*` / `release.*` / `deploy.*` / `alert.*`

### 4.3 实施要点

- Phase 1 只需要 Postgres 单表 append + 投影视图，无需引入 Kafka 级复杂度；量级上来再演进
- 事件 schema 版本化（`schemaVersion`），向后兼容

---

## 5. dsh 零分叉融合方案（E1/E2）

### 5.1 原则

**一行 dsh 源码都不碰，只用官方扩展点。**

### 5.2 包结构

```
packages/
├── agent-gateway/            # 我们自己的边界接口（唯一知道 dsh 的地方）
│   └── DshRuntime implements AgentRuntime
├── dsh-plugin-jackdevops/    # 自研 dsh 插件包（官方 dsh.bundle 分发格式）
│   ├── ctx.tools   → jackdevops.* 工具（读工作项/触发流水线/拉日志指标/创建 PR）
│   └── ctx.webhookRuntime → 流水线事件拉起 Session
└── ...
```

### 5.3 四个升级保障机制

| 机制 | 说明 |
|---|---|
| 外部依赖永不 fork | `@deepseek-ai/dsh` 锁精确版本（禁 `^`/`~`），升级=bump 版本号 |
| 只用官方扩展点 | Cordis 插件挂在官方插件旁（官方承诺的稳定接缝） |
| 契约测试升级门禁 | agent-gateway 自带契约测试；CI 对 dsh 新版本跑通即升级，失败只修 gateway 一个包；配 Dependabot 跟踪 |
| 进程级隔离 | dsh 以 `--profile sdk`（JSON-RPC）独立进程/容器运行，dsh 故障仅影响 AI 功能，CI/CD 本体不受影响 |

### 5.4 集成拓扑

```
NestJS 平台 ─┬→ agent-gateway → dsh --profile sdk（JSON-RPC，独立进程）
             │      └─ dsh-plugin-jackdevops（我们的工具）
             └→ 工作流引擎 job 类型：agent（执行 dsh Session）
```

---

## 6. 工作流引擎与 Job 插件协议（D1）

```jsonc
// 流水线 Job 类型（Phase 1 内置，agent 为预留类型）
{ "type": "build" }   // 构建（Kaniko/BuildKit，语言矩阵）
{ "type": "scan" }    // Trivy 扫描（默认步骤，不可绕过）
{ "type": "deploy" }  // 部署（Helm/Kustomize）
{ "type": "test" }    // 测试执行（框架适配器）
{ "type": "agent" }   // 预留：dsh Session（Phase 2 激活）
```

- Job = 插件：`id / inputs / outputs / timeout / retry / run(ctx)` 标准接口
- DAG 编排：YAML DSL 与可视化编辑器双向同步
- 执行器：BullMQ 队列分发，Runner 容器化执行，与核心服务解耦（Zadig Aslan + job-executor 模式）

---

## 7. Monorepo 结构

```
JackDevOps/
├── apps/
│   ├── server/          # NestJS API（模块化单体）
│   └── web/             # React 控制台
├── packages/            # 领域包（Phase 2 起：agent-gateway、dsh-plugin-jackdevops…）
├── docs/                # 本文档集
├── deploy/
│   ├── docker-compose.yml
│   └── helm/            # Phase 1 后期
├── turbo.json
├── pnpm-workspace.yaml
└── .github/workflows/ci.yml
```

---

## 8. 关键架构决策记录（ADR 摘要）

| # | 决策 | 理由 |
|---|---|---|
| 1 | 模块化单体而非微服务 | Zadig 验证可行；团队小、复杂度前置在领域而非运维 |
| 2 | PostgreSQL 单库 | 双库（Zadig）复杂度高；事件溯源单库可支撑到较大规模 |
| 3 | dsh 零分叉融合 | 上游快速迭代；适配器+契约测试控制破坏性变更风险 |
| 4 | 事件溯源自 Phase 1 | 痛点 1 的唯一解法；后补成本极高 |
| 5 | 部署≠发布（F5 内置） | Unleash 验证的需求，独立产品体验差，平台内置更顺滑 |
