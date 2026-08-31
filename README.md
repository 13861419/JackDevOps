# JackDevOps

**开源的、AI-ready 的全流程 DevOps 平台** —— 需求 → 开发 → 测试 → 发布 → 运维。

以**服务目录**为轴心，以**全链路事件流（变更指纹）**为地基，以 **AI Agent**（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 零分叉融合）为流程参与者。

## 产品原则

- **北极星指标**：新用户从安装到跑通第一条流水线 ≤ 10 分钟
- **每个核心功能都回答**：竞品为什么没做到、我们凭什么做到
- **部署 ≠ 发布**：特性开关、渐进式交付、彻底回滚

## 文档

| 文档 | 说明 |
|---|---|
| [docs/feature-inventory.md](docs/feature-inventory.md) | 30 项编号功能清单（唯一事实源） |
| [docs/PRD.md](docs/PRD.md) | 痛点驱动的产品需求文档 |
| [docs/competitive-analysis.md](docs/competitive-analysis.md) | 8 家竞品档案 + 痛点盲区矩阵 |
| [docs/architecture.md](docs/architecture.md) | 分层架构、领域模型、事件溯源、dsh 融合方案 |
| [docs/roadmap.md](docs/roadmap.md) | Phase 1~3 路线图 |

## 快速开始（Phase 0 脚手架）

```bash
# 1. 安装依赖（需要 Node 22+ 与 pnpm 11+）
pnpm install

# 2. 启动本地基础设施（PostgreSQL + Redis）
docker compose -f deploy/docker-compose.yml up -d

# 3. 启动开发服务
pnpm dev
# API:      http://localhost:3000/health
# Web:      http://localhost:5173
```

## 技术栈

TypeScript · Node 22 · NestJS · PostgreSQL · Redis/BullMQ · React + Vite · Turborepo

## License

[Apache-2.0](LICENSE)
