# JackDevOps Helm Chart

企业级 K8s 交付形态。自包含 PostgreSQL + Redis，`helm template` 可离线校验。

## 安装

```bash
# 最小安装（集群内）
helm install jackdevops deploy/helm/jackdevops \
  --set server.adminToken=$(openssl rand -hex 24) \
  --set image.tag=v0.1.0

# 生产推荐
helm install jackdevops deploy/helm/jackdevops \
  --set server.adminToken=<random> \
  --set server.deepseekApiKey=sk-... \
  --set server.githubToken=ghp_... \
  --set server.notifyProvider=dingtalk \
  --set server.notifyWebhookUrl=https://oapi.dingtalk.com/robot/send?access_token=... \
  --set ingress.enabled=true --set ingress.host=jack.example.com
```

## 组件

| 组件 | 说明 |
|---|---|
| server | NestJS API（事件溯源 + 流水线引擎），预览环境走 K8s 后端 |
| web | 控制台前端 |
| postgres | 事件存储（PVC 8Gi 可调） |
| redis | BullMQ 队列 + 跨副本事件扇出 |

## 镜像

默认使用 `ghcr.io/13861419/jackdevops-{server,web}:<tag>`；构建仓库内 `apps/*` 镜像后通过 `--set image.*` 覆盖。
