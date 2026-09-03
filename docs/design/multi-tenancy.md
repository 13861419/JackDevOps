# 多租户设计（F2 Phase 1 基础）

> 状态：待评审 ｜ 范围：Phase 1 已实现（事件层），Phase 2/3 为评审后续项

## 1. 目标与原则

- 同一 JackDevOps 实例承载多个租户（团队/子公司/部门），事件流与审计按租户隔离
- **事件溯源是唯一事实**：租户隔离必须落在事件层，而不是各模块的内存投影
- 兼容优先：`tenantId` 为可选字段，不写即视为全局/遗留事件，存量数据零迁移可用

## 2. Phase 1（本里程碑，已实现）

| 层 | 变更 |
|---|---|
| 领域事件 | `DomainEvent.tenantId?: string`（可选，缺省 = 全局） |
| 存储接口 | `EventStore.list*` 全部接受 `opts?: { tenantId }`，不传 = 全量（向后兼容） |
| InMemory | 过滤实现于 `matchesTenant` |
| PostgreSQL | `domain_events.tenant_id VARCHAR(64)` 列 + 索引（`ADD COLUMN IF NOT EXISTS`，存量行 NULL=全局） |
| 审计 | `GET /audit?tenantId=` 首个租户隔离面 |

## 3. Phase 2（待评审后实施）

1. **传播**：`AuthGuard` 从用户声明（`JACK_USERS` / OIDC claim）解析 `tenantId`，自动注入 `makeEvent`——服务代码零改动
2. **投影隔离**：`WorkItemsService/CatalogService/WorkflowsService` 的聚合投影按租户分桶（内存 store 按租户命名空间，PG store 走 P1 过滤）
3. **前端**：登录后租户切换器 + `X-Tenant-Id` 请求头
4. **迁移**：存量事件统一回填 `tenant_id='default'`

## 4. Phase 3（远期）

- 租户级配额（并发池、存储）
- 审批/通知按租户路由
- 跨租户只读聚合报表（管理视角）

## 5. 风险与决策记录

- **决策**：事件层加列而非按租户分库——单 Postgres 实例起步，避免运维复杂度；分片留作 Phase 3
- **风险**：遗漏某个查询未加过滤 → Phase 2 评审重点；用 `list*` 调用点清单做核对
- **风险**：`tenantId` 可选导致全局事件泄漏 → Phase 2 引入"严格模式"（无租户事件对非 admin 不可见）
