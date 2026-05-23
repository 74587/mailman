# Mailman 部署指南

> 本文档是 Mailman 邮件管理系统的统一部署指南，涵盖从 Docker 一键部署到 Kubernetes 集群的各种部署方式。

## 📋 目录

- [1. 快速开始 (Docker All-in-One)](#1-快速开始-docker-all-in-one)
- [2. Docker Compose 部署](#2-docker-compose-部署)
  - [2.1 生产环境](#21-生产环境)
  - [2.2 开发环境](#22-开发环境)
- [3. 本地构建 Docker 镜像](#3-本地构建-docker-镜像)
- [4. K3s 部署](#4-k3s-部署)
- [5. Helm Chart 部署](#5-helm-chart-部署)
- [6. 源码开发环境](#6-源码开发环境)
- [7. OAuth2 配置](#7-oauth2-配置)
  - [7.1 Gmail](#71-gmail)
  - [7.2 Outlook](#72-outlook)
  - [7.3 OAuth2 故障排查与 Token 维护](#73-oauth2-故障排查与-token-维护)
- [8. AI 服务配置](#8-ai-服务配置)
- [9. 环境变量说明](#9-环境变量说明)
- [10. 故障排查](#10-故障排查)

---

## 🚀 快速选择部署方式

| 部署方式 | 适用人群 | 复杂度 | 时间 | 推荐指数 |
|---------|----------|--------|------|----------|
| **Docker All-in-One** | 新手、快速体验 | ⭐ | 2分钟 | ⭐⭐⭐⭐⭐ |
| **Docker Compose 生产** | 运维人员、生产环境 | ⭐⭐ | 5分钟 | ⭐⭐⭐⭐ |
| **Docker Compose 开发** | 开发人员 | ⭐⭐ | 5分钟 | ⭐⭐⭐⭐ |
| **K3s 轻量级集群** | 边缘计算、IoT | ⭐⭐ | 5分钟 | ⭐⭐⭐⭐ |
| **Helm / Kubernetes** | 大规模生产环境 | ⭐⭐⭐ | 10分钟 | ⭐⭐⭐ |
| **源码开发** | 开发者 | ⭐⭐⭐⭐ | 15分钟 | ⭐⭐⭐ |

### 系统要求

| 资源 | 最低要求 |
|------|---------|
| CPU | 1 核 |
| 内存 | 1 GB |
| 磁盘 | 5 GB |

---

## 1. 快速开始 (Docker All-in-One)

最简单的部署方式，所有服务打包在一个 Docker 镜像中。

### 前置要求

- 安装 [Docker](https://docs.docker.com/get-docker/)

### 一键部署

```bash
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  ghcr.io/seongminhwan/mailman-all:latest
```

部署完成后，访问 **http://localhost:8080**。

> **首次登录**：系统采用首次登录自动注册机制。首次访问时输入您想使用的用户名和密码，系统将自动创建管理员账户。请立即使用强密码以防被他人抢先注册。

### 多架构支持

Docker 镜像支持多种架构，会自动选择适合的版本：

| 架构 | 平台 | 说明 |
|------|------|------|
| `linux/amd64` | Intel/AMD 64-bit | 台式机、服务器 |
| `linux/arm64` | ARM 64-bit | Apple Silicon (M1/M2/M3)、ARM 服务器 |
| `linux/arm/v7` | ARM 32-bit | 树莓派、ARM 设备（需手动指定） |

**树莓派部署**：
```bash
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --platform linux/arm/v7 \
  ghcr.io/seongminhwan/mailman-all:latest
```

### 自定义端口

```bash
# 使用 9000 端口
docker run -d \
  --name mailman \
  -p 9000:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  ghcr.io/seongminhwan/mailman-all:latest
# 访问 http://localhost:9000
```

### 容器管理

```bash
# 查看状态
docker ps

# 查看日志
docker logs -f mailman

# 重启 / 停止 / 启动
docker restart mailman
docker stop mailman
docker start mailman

# 更新到最新版本
docker stop mailman && docker rm mailman
docker pull ghcr.io/seongminhwan/mailman-all:latest
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  ghcr.io/seongminhwan/mailman-all:latest
```

### 数据备份与恢复

```bash
# 备份数据
docker run --rm \
  -v mailman_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/mailman-backup-$(date +%Y%m%d).tar.gz /data

# 恢复数据
docker run --rm \
  -v mailman_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/mailman-backup-YYYYMMDD.tar.gz -C /
```

### 架构说明

```
                    ┌─────────────────────────────────────────────┐
                    │           Docker 容器 (All-in-One)          │
                    │                                             │
  用户请求 ────────►│  ┌─────────┐                               │
      :80          │  │  Nginx  │                               │
                    │  └────┬────┘                               │
                    │       │                                     │
                    │       ├──── /api/ ────► Backend (8081)     │
                    │       ├──── /ws ──────► Backend (8081)     │
                    │       └──── /* ───────► Frontend (3000)    │
                    │                                             │
                    │  ┌──────────────┐   ┌──────────────┐       │
                    │  │   Backend    │   │   Frontend   │       │
                    │  │ (Go + SQLite)│   │  (Next.js)   │       │
                    │  └──────────────┘   └──────────────┘       │
                    │                                             │
                    │  Volume: /app/data (SQLite 数据库)          │
                    └─────────────────────────────────────────────┘
```

---

## 2. Docker Compose 部署

### 2.1 生产环境

适合需要使用 MySQL 数据库的生产环境，服务分离，性能更好。

```bash
# 1. 克隆项目
git clone https://github.com/seongminhwan/mailman.git
cd mailman

# 2. 配置环境变量
cat > .env << 'EOF'
MYSQL_ROOT_PASSWORD=your_secure_root_password
MYSQL_DATABASE=mailman
MYSQL_USER=mailman
MYSQL_PASSWORD=your_secure_mailman_password
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
EOF

# 3. 启动服务
docker-compose up -d

# 4. 查看状态
docker-compose ps
```

**访问地址**：
- 前端界面：http://localhost:80
- 后端 API：内部通过 Nginx 代理

**管理命令**：
```bash
docker-compose logs -f          # 查看日志
docker-compose restart           # 重启服务
docker-compose down              # 停止服务
docker-compose down -v           # 停止并删除数据（慎用）
docker-compose pull && docker-compose up -d  # 更新
```

**架构**：
```
  ┌─────────────────────────────────────────────────────────────────┐
  │                        Docker Network                           │
  │  ┌───────────┐      ┌───────────┐      ┌───────────────┐       │
  │  │  Frontend │ ───► │  Backend  │ ───► │     MySQL     │       │
  │  │  (Nginx)  │      │    (Go)   │      │     (8.0)     │       │
  │  └─────┬─────┘      └───────────┘      └───────────────┘       │
  └────────┼────────────────────────────────────────────────────────┘
           ▼
       用户 (:80)
```

### 2.2 开发环境

支持代码热重载，适合开发调试。

```bash
# 使用开发配置启动
docker-compose -f docker-compose.dev.yml up -d
```

**访问地址**：
- 前端界面：http://localhost:3000
- 后端 API：http://localhost:8080
- 数据库：localhost:3307

**开发特性**：
- 修改 `frontend/` 目录下的代码会自动重载
- 修改 `backend/` 目录下的代码会自动重新编译

---

## 3. 本地构建 Docker 镜像

适合需要自定义镜像、离线部署或私有镜像仓库的场景。

### 构建一体化镜像 (All-in-One)

```bash
git clone https://github.com/seongminhwan/mailman.git
cd mailman

# 构建
docker build -t mailman-all:local -f Dockerfile.all .

# 运行
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  mailman-all:local
```

### 分别构建前后端

```bash
# 构建后端
docker build -t mailman-backend:local -f backend/Dockerfile backend/

# 构建前端（含 Nginx）
docker build -t mailman-frontend:local -f frontend/Dockerfile.nginx frontend/

# 创建网络并运行
docker network create mailman-network

docker run -d \
  --name mailman-backend \
  --network mailman-network \
  -p 8080:8080 \
  -v mailman_data:/app/data \
  -e DB_DRIVER=sqlite \
  -e DB_NAME=/app/data/mailman.db \
  mailman-backend:local

docker run -d \
  --name mailman-frontend \
  --network mailman-network \
  -p 80:80 \
  mailman-frontend:local
```

### 多架构构建

```bash
# 创建 Buildx 构建器
docker buildx create --name multiarch-builder --use
docker buildx inspect --bootstrap

# 构建多架构镜像
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-registry.com/mailman-all:latest \
  -f Dockerfile.all \
  --push \
  .
```

### 离线部署

```bash
# 导出镜像
docker save mailman-all:local -o mailman-all.tar

# 目标机器上导入
docker load -i mailman-all.tar
```

### Dockerfile 说明

| Dockerfile | 用途 | 输出端口 |
|------------|------|---------|
| `Dockerfile.all` | 一体化镜像（前端+后端+Nginx） | 80 |
| `backend/Dockerfile` | 后端 API 服务 | 8080 |
| `frontend/Dockerfile.nginx` | 前端（Next.js + Nginx） | 80 |
| `frontend/Dockerfile` | 前端（纯 Next.js） | 3000 |
| `backend/Dockerfile.dev` | 后端开发模式（热重载） | 8080 |
| `frontend/Dockerfile.dev` | 前端开发模式（热重载） | 3000 |

---

## 4. K3s 部署

K3s 是轻量级 Kubernetes，适合边缘计算、IoT 和开发环境。

### 前置条件

```bash
# 安装 K3s
curl -sfL https://get.k3s.io | sh -

# 配置 kubectl
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config

# 安装 Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# 验证
kubectl get nodes
helm version
```

### 一键部署脚本

```bash
./deploy-k3s.sh
# 脚本自动显示访问地址
```

### 手动部署

```bash
# 1. 部署 MariaDB 数据库
kubectl apply -f ./helm/mailman/matrixdb-deployment.yaml
kubectl wait --for=condition=ready pod -l app=mariadb --timeout=300s

# 2. 部署应用
helm install mailman ./helm/mailman \
  --namespace default \
  --values ./helm/mailman/values-matrixdb-production.yaml \
  --values ./helm/mailman/values-k3s.yaml

# 3. 等待就绪
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=mailman --timeout=300s
```

### 访问方式

#### 方式 1：NodePort（最简单）

```bash
kubectl patch svc mailman-frontend -p '{"spec":{"type":"NodePort"}}'
PORT=$(kubectl get svc mailman-frontend -o jsonpath='{.spec.ports[0].nodePort}')
echo "访问地址: http://localhost:$PORT"
```

#### 方式 2：Traefik Ingress（推荐）

```bash
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mailman-ingress
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  rules:
  - host: mailman.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: mailman-frontend
            port:
              number: 80
EOF

echo "127.0.0.1 mailman.local" | sudo tee -a /etc/hosts
```

#### 方式 3：端口转发（调试）

```bash
kubectl port-forward svc/mailman-frontend 8080:80
# 访问 http://localhost:8080
```

### K3s 资源优化配置

创建 `values-k3s.yaml`：

```yaml
mailman:
  backend:
    replicaCount: 1
    resources:
      limits:
        cpu: 500m
        memory: 512Mi
      requests:
        cpu: 200m
        memory: 256Mi
  frontend:
    replicaCount: 1
    resources:
      limits:
        cpu: 250m
        memory: 256Mi
      requests:
        cpu: 100m
        memory: 128Mi

persistence:
  data:
    storageClassName: local-path
  logs:
    storageClassName: local-path
```

### K3s 生产环境 HTTPS

```bash
# 安装 cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# 创建 ClusterIssuer
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: traefik
EOF

# TLS Ingress
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mailman-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    traefik.ingress.kubernetes.io/router.tls: "true"
spec:
  tls:
  - hosts:
    - mailman.yourdomain.com
    secretName: mailman-tls
  rules:
  - host: mailman.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: mailman-frontend
            port:
              number: 80
EOF
```

### K3s 常用操作

```bash
# 查看所有资源
kubectl get all -l app.kubernetes.io/name=mailman

# 日志
kubectl logs -f deployment/mailman-backend
kubectl logs -f deployment/mailman-frontend

# 重启
kubectl rollout restart deployment/mailman-backend
kubectl rollout restart deployment/mailman-frontend

# 更新
helm upgrade mailman ./helm/mailman \
  --values ./helm/mailman/values-matrixdb-production.yaml \
  --values ./helm/mailman/values-k3s.yaml

# 回滚
helm rollback mailman

# 卸载
helm uninstall mailman
kubectl delete -f ./helm/mailman/matrixdb-deployment.yaml
```

### K3s 数据库备份

```bash
# 导出
kubectl exec -it $(kubectl get pod -l app=mariadb -o jsonpath='{.items[0].metadata.name}') -- \
  mysqldump -u mailman -pmailman123 mailman > mailman_backup.sql

# 导入
kubectl exec -i $(kubectl get pod -l app=mariadb -o jsonpath='{.items[0].metadata.name}') -- \
  mysql -u mailman -pmailman123 mailman < mailman_backup.sql
```

---

## 5. Helm Chart 部署

适合标准 Kubernetes 集群的生产环境部署。

### 部署架构

```
Internet → Ingress → Frontend Service (Port 80)
                        ↓
                   Nginx Proxy
                        ↓
                   Backend Service (Port 8080, ClusterIP only)
                        ↓
                   MariaDB (Port 3306, ClusterIP only)
```

### 前置条件

- Kubernetes 1.24+
- Helm 3.8+
- kubectl 已配置集群访问权限

### 部署步骤

```bash
# 1. 部署 MariaDB
kubectl apply -f ./helm/mailman/matrixdb-deployment.yaml

# 2. 部署应用
helm install mailman ./helm/mailman \
  --namespace default \
  --values ./helm/mailman/values-matrixdb-production.yaml

# 3. 验证
kubectl get pods -l app.kubernetes.io/name=mailman
kubectl get services
```

### 服务信息

| 服务名称 | 类型 | 端口 | 访问方式 |
|----------|------|------|----------|
| mailman-frontend | ClusterIP | 80 | 通过 Ingress |
| mailman-backend | ClusterIP | 8080 | 仅内部 |
| mariadb | ClusterIP | 3306 | 仅内部 |

### 镜像配置

```yaml
mailman:
  backend:
    image:
      registry: ghcr.io
      repository: seongminhwan/mailman-backend
      tag: "latest"  # 或指定版本如 "v0.1.21"
  frontend:
    image:
      registry: ghcr.io
      repository: seongminhwan/mailman-frontend
      tag: "latest"
```

### 生产环境 Ingress + TLS

```bash
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mailman-ingress
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - mailman.yourdomain.com
    secretName: mailman-tls
  rules:
  - host: mailman.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: mailman-frontend
            port:
              number: 80
EOF
```

### Helm 管理

```bash
# 更新
helm upgrade mailman ./helm/mailman \
  --values ./helm/mailman/values-matrixdb-production.yaml

# 查看历史
helm history mailman

# 回滚
helm rollback mailman

# 卸载
helm uninstall mailman
kubectl delete -f ./helm/mailman/matrixdb-deployment.yaml
```

### 配置文件说明

| 文件 | 用途 |
|------|------|
| `values-matrixdb-production.yaml` | 生产环境完整配置 |
| `values-k3s.yaml` | K3s 优化配置（低资源） |
| `values-local-test.yaml` | 本地测试最小配置 |

---

## 6. 源码开发环境

适合开发者进行调试和二次开发。

### 前置要求

- Go 1.23+
- Node.js 18+
- MySQL 8.0+ 或 SQLite

### 安装步骤

```bash
# 1. 克隆项目
git clone https://github.com/seongminhwan/mailman.git
cd mailman

# 2. 数据库（二选一）

# 选择 A：使用 SQLite（无需额外数据库）
# 直接使用默认配置即可

# 选择 B：使用 Docker 启动 MySQL
docker run -d \
  --name mailman-dev-db \
  -e MYSQL_ROOT_PASSWORD=root123 \
  -e MYSQL_DATABASE=mailman \
  -e MYSQL_USER=mailman \
  -e MYSQL_PASSWORD=mailman123 \
  -p 3306:3306 \
  mysql:8.0

# 3. 配置并启动后端
cd backend
cat > .env << 'EOF'
DB_DRIVER=sqlite
DB_NAME=./mailman.db
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
LOG_LEVEL=DEBUG
EOF

go mod download
go run cmd/mailman/main.go

# 4. 配置并启动前端（新终端）
cd frontend
cat > .env.local << 'EOF'
NEXT_PUBLIC_API_URL=http://localhost:8080
EOF

npm install
npm run dev
```

### 访问地址

- 前端界面：http://localhost:3000
- 后端 API：http://localhost:8080
- API 文档：http://localhost:8080/swagger/index.html

### 本地开发命令

```bash
# 后端构建
cd backend
go build -o mailman ./cmd/mailman
./mailman

# 后端开发模式（含竞态检测）
make dev

# 前端构建
cd frontend
npm run build
npm start
```

### 密码重置

```bash
cd backend
make reset-password
./reset-password -username=admin -password=new_password -force
```

---

## 7. OAuth2 配置

系统支持通过 Web 界面配置 OAuth2，也可以在 Kubernetes 中通过 Secret 配置。

### 7.1 Gmail

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建新项目或选择现有项目
3. 启用 Gmail API
4. 创建 OAuth2 客户端 ID（Web 应用类型）
5. 添加重定向 URI：`http://your-domain/api/oauth2/callback/gmail`
   - 本地开发：`http://localhost:8080/api/oauth2/callback/gmail`
6. 获取 Client ID 和 Client Secret
7. 在 Mailman 「设置 → OAuth2 配置」中添加配置

**权限范围建议**：使用 `gmail.readonly` 只读权限，避免过于宽泛的 `https://mail.google.com/` 权限（减少 Google 审查导致的权限撤销）。

### 7.2 Outlook

1. 访问 [Azure Portal](https://portal.azure.com/)
2. 注册新应用程序
3. 添加 API 权限：`Mail.Read`、`Mail.Send`
4. 添加重定向 URI：`http://your-domain/api/oauth2/callback/outlook`
   - 本地开发：`http://localhost:8080/api/oauth2/callback/outlook`
5. 获取 Client ID 和 Client Secret
6. 在 Mailman 「设置 → OAuth2 配置」中添加配置

### Kubernetes 中配置 OAuth2 Secret

```bash
kubectl create secret generic mailman-oauth2 \
  --from-literal=gmail-client-id='your-client-id' \
  --from-literal=gmail-client-secret='your-client-secret' \
  --from-literal=outlook-client-id='your-client-id' \
  --from-literal=outlook-client-secret='your-client-secret'
```

### 7.3 OAuth2 故障排查与 Token 维护

#### Token 健康检查

系统提供 Token 健康检查 API 和命令行工具：

```bash
# API 检查
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:8080/api/oauth2/token-health

# 命令行工具
cd backend
go run cmd/oauth2-health-check/main.go
```

#### 健康状态分类

| 状态 | 说明 |
|------|------|
| ✅ Healthy | Token 正常，可以成功刷新 |
| ⚠️ Warning | Token 接近过期或有轻微问题 |
| ❌ Needs Reauth | Refresh token 失效，需要重新授权 |
| ❌ Error | 严重错误，无法自动恢复 |

#### 常见 Token 问题

**`invalid_grant` 错误**：需要重新授权 OAuth2，删除现有账户后重新添加并完成授权流程。

**Token 被限流**：系统设有 2 分钟刷新限制，等待后重试或重启服务器清除缓存。

#### 维护建议

- **每周**：使用健康检查工具验证状态
- **每月**：检查前端监控组件显示的状态
- **每季度**：重新授权长期未使用的账户
- 即使不需要邮件，也建议每月使用一次保持 token 活跃

---

## 8. AI 服务配置

AI 配置通过 Web 界面管理，不再使用环境变量。

### 支持的提供商

| 提供商 | 支持模型 | 配置要求 |
|--------|----------|----------|
| **OpenAI** | GPT-3.5, GPT-4, GPT-4o | API 密钥、基础 URL |
| **Claude** | Claude-3, Claude-3.5 | API 密钥、基础 URL |
| **Gemini** | Gemini Pro, Gemini Ultra | API 密钥、基础 URL |

### 配置步骤

1. 登录到 Mailman 前端界面
2. 进入「设置 → AI 配置」
3. 点击「添加 AI 配置」
4. 选择提供商，输入 API 密钥和基础 URL
5. 点击「测试连接」验证
6. 保存并激活配置

### 获取 API 密钥

- **OpenAI**：[OpenAI Platform](https://platform.openai.com/) → API Keys
- **Claude**：[Anthropic Console](https://console.anthropic.com/) → API Keys
- **Gemini**：[Google AI Studio](https://makersuite.google.com/)

---

## 9. 环境变量说明

### 服务器配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `SERVER_HOST` | 监听地址 | `localhost` |
| `SERVER_PORT` | 监听端口 | `8080` |
| `LOG_LEVEL` | 日志级别 | `INFO` (`DEBUG`/`INFO`/`WARN`/`ERROR`) |
| `LOG_QUIET_PREFIXES` | 静默日志前缀 | *(空)* (如 `FetcherService,AccountSyncer`) |

### 数据库配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DB_DRIVER` | 数据库驱动 | `sqlite` (`sqlite`/`mysql`/`postgres`) |
| `DB_NAME` | 数据库名/文件路径 | `mailman.db` |
| `DB_HOST` | 数据库主机 | `localhost` |
| `DB_PORT` | 数据库端口 | MySQL: `3306`, PostgreSQL: `5432` |
| `DB_USER` | 数据库用户 | `mailman` |
| `DB_PASSWORD` | 数据库密码 | *(空)* |
| `DB_SSLMODE` | SSL 模式 | `disable` |

### OAuth2 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `GMAIL_REDIRECT_URI` | Gmail OAuth2 回调 | `http://localhost:8080/api/oauth2/callback/gmail` |
| `OUTLOOK_REDIRECT_URI` | Outlook OAuth2 回调 | `http://localhost:8080/api/oauth2/callback/outlook` |

> **注意**：OAuth2 的 Client ID 和 Client Secret 通过 Web 界面的「设置 → OAuth2 配置」进行配置，无需在环境变量中设置。

### 前端环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `NEXT_PUBLIC_API_URL` | 后端 API 地址 | *(空)* |
| `NEXT_PUBLIC_API_BASE_URL` | 完整 API 基础 URL | `http://localhost:8080` |
| `NODE_ENV` | 运行环境 | `development` |

---

## 10. 故障排查

### 端口被占用

```bash
# 检查端口
lsof -i :8080
netstat -an | grep 8080

# 方案 1：终止占用进程
kill -9 <PID>

# 方案 2：使用其他端口
docker run -d --name mailman -p 9000:80 ghcr.io/seongminhwan/mailman-all:latest
```

### 容器无法启动

```bash
# 检查日志
docker logs mailman

# 强制删除后重新运行
docker rm -f mailman
```

### 无法连接数据库

```bash
# SQLite：确保数据库文件路径可写
ls -la ./mailman.db

# MySQL：测试连接
mysql -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME
```

### API 连接失败

```bash
# 检查后端健康
curl http://localhost:8080/health
curl http://localhost:8080/api/system/info
```

### 前端页面空白

```bash
# 检查前端构建
cd frontend
npm run build

# 检查 API 代理配置
# 确保 next.config.js 中的 rewrites 配置正确
```

### Docker 未运行

```bash
# macOS：打开 Docker Desktop
# Linux：sudo systemctl start docker
# Windows：打开 Docker Desktop
```

### 镜像下载失败

```bash
# 检查网络连接
docker pull ghcr.io/seongminhwan/mailman-all:latest

# 或使用离线镜像（参见「本地构建 Docker 镜像」章节）
```

### K3s 特定问题

```bash
# Pod 无法调度 - 清除 master 污点
kubectl taint nodes --all node-role.kubernetes.io/master-

# Traefik 不工作
kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik
kubectl logs -n kube-system -l app.kubernetes.io/name=traefik

# 存储问题
kubectl get pvc
kubectl get pv
sudo ls -la /var/lib/rancher/k3s/storage

# DNS 解析测试
kubectl run -it --rm debug --image=busybox --restart=Never -- nslookup mailman-backend

# 重启 K3s
sudo systemctl restart k3s
sudo journalctl -u k3s -f
```

### Kubernetes 问题

```bash
# 后端无法启动
kubectl logs -l app.kubernetes.io/component=backend

# 前端代理失败
kubectl get svc backend
kubectl logs -l app.kubernetes.io/component=frontend

# 数据库连接
kubectl logs -l app=mariadb
kubectl exec -it deployment/mailman-backend -- mysql -h mariadb -u mailman -p

# 进入 Pod 调试
kubectl exec -it deployment/mailman-backend -- bash
kubectl exec -it deployment/mailman-frontend -- sh

# 端口转发
kubectl port-forward deployment/mailman-frontend 8080:80
kubectl port-forward deployment/mailman-backend 8081:8080

# 查看所有资源
kubectl get all -l app.kubernetes.io/name=mailman
```

### 性能问题

```bash
# 检查容器资源使用
docker stats

# 检查磁盘空间
df -h

# 清理无用 Docker 资源
docker system prune -a
```

---

## 📞 获取帮助

1. **查看日志**：`docker logs mailman` 或 `kubectl logs`
2. **检查配置**：确认环境变量设置正确
3. **重启服务**：`docker restart mailman`
4. **提交 Issue**：[GitHub Issues](https://github.com/seongminhwan/mailman/issues)

---

**Mailman** - 智能邮件管理系统 🚀
