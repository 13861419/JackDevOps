# JackDevOps

**开源的、AI-ready 的全流程 DevOps 平台** —— 需求 → 开发 → 测试 → 发布 → 运维。

以**服务目录**为轴心，**全链路事件流（变更指纹）**为地基，**AI Agent**（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 零分叉融合）为流程参与者。

## 产品原则

- **北极星指标**：新用户从安装到跑通第一条流水线 ≤ 10 分钟
- **每个核心功能都回答**：竞品为什么没做到、我们凭什么做到
- **部署 ≠ 发布**：特性开关、渐进式交付、彻底回滚

## 功能全景（Phase 1~3 已交付）

| 领域 | 能力 |
|---|---|
| 需求与协作 | 工作项状态机（事件化）、四角色工作台、⌘K 命令面板 |
| CI/CD | Git Webhook 触发、DAG 工作流引擎、真实命令执行器、Docker 容器构建、Trivy 安全门禁、并发池 |
| 发布治理 | 渐进式交付（canary/blue-green/rolling）、审批流、链式回滚、SLSA-lite 来源证明 |
| 测试 | 测试套件与运行记录、按变更路径智能选择用例 |
| 可观测 | 全链路审计、DORA 四指标（部署频率/变更失败率/MTTR/Lead Time） |
| AI | agent-gateway 多模型网关（OpenAI 兼容）、发布风险摘要、失败自动归因、目录问答 |
| 平台工程 | 黄金路径脚手架、TechDocs（陈旧度自动标记）、配置漂移检测与调和、PR Preview 环境（Docker 实装）、外部密钥引用 |
| 基础 | RBAC + Bearer 认证、IM 通知、CLI（`jack`）、Helm Chart、事件溯源持久化（PostgreSQL） |

## 快速开始

```bash
# 1. 安装依赖（需要 Node 22+ 与 pnpm 11+）
pnpm install

# 2. 启动本地基础设施（PostgreSQL + Redis，宿主端口 5433/6380 避免冲突）
docker compose -f deploy/docker-compose.yml up -d

# 3. 启动 API（未设置 DATABASE_URL 时自动降级为内存事件存储）
$env:DATABASE_URL = "postgresql://jackdevops:jackdevops@localhost:5433/jackdevops"
pnpm dev
# API: http://localhost:3000   Web: pnpm dev（apps/web，http://localhost:5173）

# 4. 一键填充演示数据（3 服务 / 9 运行 / 9 发布 / 开关 / 测试套件）
curl -X POST http://localhost:3000/demo/seed \
  -H "authorization: Bearer dev-admin-token" \
  -H "content-type: application/json" -d '{"force":true}'
```

打开 `http://localhost:5173` —— 工作台、DORA 看板、审计时间线立即是"活"的。

## CLI

```bash
cd apps/cli && pnpm build && node dist/index.js --help

jack login <token> --server http://localhost:3000
jack quickstart --name my-service          # 服务 + 流水线一步到位
jack scaffold --slug demo --name 演示 --language node
jack dora --days 30                        # DORA 四指标（含 Lead Time）
jack drift demo-order --image registry/app:v1
jack provenance <releaseId>                # SLSA-lite 构建证明
```

## 验收门禁

```bash
# 新人 10 分钟测试（Phase 1 起每阶段必过）
node apps/server/scripts/ten-minute-test.mjs

# 各阶段冒烟
node apps/server/scripts/smoke-m5.mjs      # Preview 环境 + 容器构建
node apps/server/scripts/smoke-phase3.mjs  # 脚手架/文档/漂移/问答/密钥/证明
```

## 架构一图流

```
Git Push/PR ─▶ Webhook ─▶ 工作流引擎(DAG) ─▶ Job 执行器(build/test/scan/container-build)
                                 │                    │
需求 ◀──────── 变更指纹 traceId ───┼────────────────────┤
                                 ▼                    ▼
                     事件溯源(PostgreSQL) ─▶ 审计 / DORA / Trace
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
      渐进式交付+审批       特性开关+漂移         agent-gateway(LLM)
      Release/回滚/证明     TechDocs/密钥         风险摘要/诊断/问答
```

## 文档

| 文档 | 说明 |
|---|---|
| [docs/feature-inventory.md](docs/feature-inventory.md) | 30 项编号功能清单（唯一事实源） |
| [docs/PRD.md](docs/PRD.md) | 痛点驱动的产品需求文档 |
| [docs/competitive-analysis.md](docs/competitive-analysis.md) | 8 家竞品档案 + 痛点盲区矩阵 |
| [docs/architecture.md](docs/architecture.md) | 分层架构、领域模型、事件溯源、dsh 融合方案 |
| [docs/roadmap.md](docs/roadmap.md) | Phase 1~3 路线图与交付状态 |

## 技术栈

TypeScript · Node 22 · NestJS · PostgreSQL · Redis/BullMQ · React + Vite · Turborepo

## License

[Apache-2.0](LICENSE)
