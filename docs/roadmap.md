# JackDevOps 路线图（Roadmap）

> 功能 ID 见 `feature-inventory.md`。每阶段交付前执行"新人 10 分钟测试"门禁。

---

## Phase 0 —— 项目奠基（本次交付 ✅）

- [x] 文档五件套：feature-inventory / PRD / competitive-analysis / architecture / roadmap
- [x] Monorepo 脚手架：apps/server（NestJS）+ apps/web（Vite React）+ docker-compose + CI
- [ ] 设计评审：事件溯源 schema（F1）与服务目录领域模型（A2）为最高优先级评审项

## Phase 1 —— CI/CD 核心闭环 + 上手快基石

**主题**：跑通最小闭环，埋下两大差异化地基。

| 功能 | ID | 说明 |
|---|---|---|
| 事件溯源 + 变更指纹 | F1 | 全链路 traceId，**第一优先级** |
| 需求/工作项管理 | A1 | 状态流转事件化 |
| 服务目录（轻量版） | A2 | 领域模型轴心 |
| 角色化工作台 | A3 | 四角色首页 |
| Git 深度集成 | B1 | PR 驱动、状态回写 |
| PR 规则评审 | B2 | 规则版 |
| CLI + API-first | B5 | 同源 API |
| Trivy 扫描门禁 | C3 | 流水线默认步骤 |
| 工作流引擎 | D1 | DAG + Job 插件协议（预留 agent 类型） |
| 模板库 | D2 | 构建/部署/流水线模板 |
| 环境管理 | D3 | 面向服务的环境 |
| Onboarding Wizard | D7 | 10 分钟闭环向导 |
| IM 通知 | A4 | 钉钉/企微/飞书/Slack webhook |
| RBAC 基础 + OIDC | F2 | 权限模型 |
| 双形态交付 + Demo 模式 | F10 | Helm + Compose |
| ⌘K 命令面板 | F11 | 全局跳转 |

**验收**：新人 10 分钟跑通首条流水线；任何构建/部署可回溯到需求与 PR；Trivy 不可绕过。

## Phase 2 —— 发布治理 + AI 落地

**主题**：渐进式交付 + dsh 融合，AI 从"点状"到"流程参与者"。

- Web 调试三件套（F4）、DORA 看板（F6）、审计日志（F3）
- 渐进式交付（D4）、高并发构建（D6）、PR Preview 环境（D8）
- 测试管理 + 质量门禁（C1/C2）、智能测试选择规则版（C4）、失败自动归因（C5）
- **dsh 融合**：agent-gateway + 契约测试 + LLM 多模型（E1/E2）、AI 侧边栏（E3）、AI 风险摘要审批卡（E4）、上下文 AI 诊断（E5）
- IM 审批卡片完整版（A4）、自动 Release Notes 规则版（A5）

**验收**：审批人可看到 AI 风险摘要；发布失败 AI 诊断携带全链路上文；DORA 四指标自动产出。

## Phase 3 —— 平台工程深化

**主题**：IDP 能力与治理闭环。

- 黄金路径脚手架（B3）、TechDocs（B4）
- 配置漂移检测与 reconcile（F7）、关联物回滚（D5，DB 迁移仅提示）
- 目录问答 Agent（E6）、Lead Time 自动化（A5 完整版）
- External Secrets（F8）、多租户（F2）、SLSA/FinOps（F9 候选）、插件市场

**验收**：差异化承诺全部兑现（PRD §2 七大痛点闭环）。

### Phase 3 交付状态（M6 收尾，2026-09）

- [x] B3 黄金路径脚手架：`POST /scaffold` + CLI `jack scaffold`
- [x] B4 TechDocs：文档 CRUD + 陈旧度标记 + Web 文档页
- [x] F7 漂移检测与 reconcile：期望 vs 实际快照 + Web 漂移页
- [x] D5 关联物回滚：rollback 自动对上一 stable 版本发 redeploy
- [x] E6 目录问答 Agent：`/ai/catalog-qa`（LLM/Rules 双模式）
- [x] A5 完整版：DORA Lead Time for Changes（runStarted → promote 均值）
- [x] F8 密钥外部引用模型：只存 `external://provider/ref` 指针，绝不存值
- [x] F9-lite SLSA：promote 时落 `release.provenance_recorded` + `GET /releases/:id/provenance`
- [x] M17 Git 状态回写：push 触发的 run 完成后回写 GitHub commit status（`JACK_GITHUB_TOKEN`，缺失优雅跳过）
- [x] M17 D6 容器构建实测：docker build 上下文相对 Dockerfile 解析修复
- [x] M18 B2 AI 代码评审：PR webhook 拉取 diff → 规则 + dsh AI 双评审 → 回写 `jackdevops/ai-review` status（实测真实 DeepSeek 评审）
- [x] M19 A4 完整版：审批 IM 卡片（钉钉 actionCard/飞书 interactive/企微 markdown/Slack）
- [x] M20 F10 企业交付：Helm Chart（server/web/pg/redis 全套，lint+template 通过）
- [x] M20 F10 企业交付：Helm Chart（server/web/pg/redis 全套，lint+template 通过）
- [x] M21 kind 集群实测：D8 Preview K8s 后端端到端验证（pod 部署/NodePort/确定性回收）
- [x] M22 插件市场：内置目录 + 安装/卸载（事件溯源注水）、动态 Job 类型、fail-closed 400 校验
- [x] M23-M24 F2 多租户：Phase 1 事件层租户隔离（tenant_id 列+过滤）；Phase 2 ALS 租户传播（makeEvent 自动标记，非 admin 审计强制本租户）；Phase 3（配额/分片）留待评审
- [x] M26 PG 事件快照：`aggregate_snapshots` 表 + 保存/加载 API + Preview 聚合增量回放（每 20 版本自动快照）
- [ ] 远期：多租户 Phase 3（配额/分片）；平台进入维护迭代

---

## 里程碑原则

1. **F1 事件流是第一优先级**：任何阶段牺牲功能不牺牲事件流完整性
2. **AI 不提前**：Phase 1 不引 dsh 依赖，但 Job 协议预留
3. **每阶段以"新人 10 分钟测试"收口**：易用性是产品核心，不是附加项
