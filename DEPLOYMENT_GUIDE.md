# 📦 Mailman 项目部署启动指南

> **版本**: 2025-12-28  
> **适用范围**: 开发环境 / 测试环境 / 生产环境

## 📋 目录

- [项目概述](#项目概述)
- [系统要求](#系统要求)
- [部署方式](#部署方式)
  - [方式一：Docker 一键部署](#方式一docker-一键部署推荐)
  - [方式二：Docker Compose 部署](#方式二docker-compose-部署)
  - [方式三：本地构建 Docker 镜像](#方式三本地构建-docker-镜像)
  - [方式四：本地源码开发](#方式四本地源码开发)
- [环境变量配置](#环境变量配置)
  - [后端环境变量](#后端环境变量)
  - [前端环境变量](#前端环境变量)
  - [日志配置](#日志配置)
- [首次登录与用户注册](#首次登录与用户注册)
- [后续配置](#后续配置)
- [常用运维命令](#常用运维命令)
- [故障排除](#故障排除)


---

## 项目概述

Mailman 是一个智能邮件管理系统，采用前后端分离架构：

| 组件 | 技术栈 | 默认端口 |
|------|--------|----------|
| **后端 API** | Go 1.23+ (Gorilla Mux, GORM) | 8080 |
| **前端界面** | Next.js 14 (TypeScript, Tailwind CSS) | 3000 |
| **数据库** | SQLite (默认) / MySQL 8.0+ | - |

---

## 系统要求

### 最小配置

| 资源 | 要求 |
|------|------|
| CPU | 1 核 |
| 内存 | 1 GB |
| 磁盘 | 5 GB |

### 软件依赖

| 部署方式 | 必需软件 |
|----------|----------|
| Docker 部署 | Docker 20.10+ |
| Docker Compose | Docker + Docker Compose |
| 源码开发 | Go 1.23+, Node.js 18+, npm |

---

## 部署方式

### 方式一：Docker 一键部署（推荐）

最简单的部署方式，适合快速体验和小规模生产使用。

```bash
# 基础部署
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  ghcr.io/seongminhwan/mailman-all:latest
```

#### 多架构支持

| 架构 | 平台 | 是否自动选择 |
|------|------|-------------|
| `linux/amd64` | Intel/AMD 64位 | ✅ 自动 |
| `linux/arm64` | Apple Silicon (M1/M2/M3)、ARM 服务器 | ✅ 自动 |
| `linux/arm/v7` | 树莓派、ARM 32位设备 | ❌ 需手动指定 |

**树莓派部署**：
```bash
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --platform linux/arm/v7 \
  ghcr.io/seongminhwan/mailman-all:latest
```

#### 自定义端口

```bash
# 使用自定义端口（如 9000）
docker run -d \
  --name mailman \
  -p 9000:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  ghcr.io/seongminhwan/mailman-all:latest
```

#### 访问地址

- **前端界面**: http://localhost:8080
- **API 文档**: http://localhost:8080/swagger/index.html
- **健康检查**: http://localhost:8080/health

---

### 方式二：Docker Compose 部署

适合需要使用 MySQL 数据库的生产环境。

#### 1. 创建环境配置

```bash
# 克隆项目
git clone https://github.com/seongminhwan/mailman.git
cd mailman

# 创建环境配置文件
cat > .env << 'EOF'
# MySQL 数据库配置
MYSQL_ROOT_PASSWORD=your_secure_root_password
MYSQL_DATABASE=mailman
MYSQL_USER=mailman
MYSQL_PASSWORD=your_secure_mailman_password
EOF
```

#### 2. 启动服务

```bash
# 生产环境
docker-compose up -d

# 或开发环境（支持热重载）
docker-compose -f docker-compose.dev.yml up -d
```

#### 3. 访问地址

| 环境 | 前端地址 | 后端 API |
|------|----------|----------|
| 生产 | http://localhost:80 | 内部通过 Nginx 代理 |
| 开发 | http://localhost:3000 | http://localhost:8080 |

---

### 方式三：本地构建 Docker 镜像

适合需要自定义镜像、离线部署或私有镜像仓库的场景。

#### 前置要求

```bash
# 验证 Docker 和 Docker Buildx
docker --version       # Docker 20.10+
docker buildx version  # 多架构构建需要
```

#### 方案 A：构建一体化镜像（All-in-One）

一体化镜像包含前端、后端和 Nginx，适合单机部署。

```bash
# 克隆项目
git clone https://github.com/seongminhwan/mailman.git
cd mailman

# 构建一体化镜像
docker build -t mailman-all:local -f Dockerfile.all .

# 运行本地构建的镜像
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  mailman-all:local
```

#### 方案 B：分别构建前端和后端镜像

适合微服务架构或需要独立扩展前后端的场景。

```bash
# 构建后端镜像
docker build -t mailman-backend:local -f backend/Dockerfile backend/

# 构建前端镜像（包含 Nginx）
docker build -t mailman-frontend:local -f frontend/Dockerfile.nginx frontend/

# 也可以构建纯 Next.js 前端镜像（不含 Nginx）
docker build -t mailman-frontend-pure:local -f frontend/Dockerfile frontend/
```

**运行分离镜像**：

```bash
# 创建网络
docker network create mailman-network

# 运行后端
docker run -d \
  --name mailman-backend \
  --network mailman-network \
  -p 8080:8080 \
  -v mailman_data:/app/data \
  -e DB_DRIVER=sqlite \
  -e DB_NAME=/app/data/mailman.db \
  mailman-backend:local

# 运行前端（使用 Dockerfile.nginx）
docker run -d \
  --name mailman-frontend \
  --network mailman-network \
  -p 80:80 \
  mailman-frontend:local
```

#### 方案 C：多架构构建（支持 AMD64 + ARM64）

适合需要在不同架构设备上运行的场景。

```bash
# 1. 创建并使用 Buildx 构建器
docker buildx create --name multiarch-builder --use
docker buildx inspect --bootstrap

# 2. 构建多架构一体化镜像（推送到私有仓库）
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-registry.com/mailman-all:latest \
  -f Dockerfile.all \
  --push \
  .

# 3. 仅构建当前架构（不推送，加载到本地）
docker buildx build \
  --platform linux/amd64 \
  -t mailman-all:local \
  -f Dockerfile.all \
  --load \
  .
```

**构建 ARM64 镜像（适用于 Apple Silicon）**：

```bash
docker buildx build \
  --platform linux/arm64 \
  -t mailman-all:arm64 \
  -f Dockerfile.all \
  --load \
  .
```

#### 方案 D：使用 Docker Compose 本地构建

直接使用 Docker Compose 构建并运行：

```bash
# 创建环境配置
cat > .env << 'EOF'
MYSQL_ROOT_PASSWORD=your_secure_root_password
MYSQL_DATABASE=mailman
MYSQL_USER=mailman
MYSQL_PASSWORD=your_secure_mailman_password
EOF

# 构建并启动（生产环境）
docker-compose build
docker-compose up -d

# 或开发环境
docker-compose -f docker-compose.dev.yml build
docker-compose -f docker-compose.dev.yml up -d
```

#### 镜像文件说明

| Dockerfile | 用途 | 输出 |
|------------|------|------|
| `Dockerfile.all` | 一体化镜像（前端+后端+Nginx） | 单个容器，端口 80 |
| `backend/Dockerfile` | 后端 API 服务 | Go 二进制，端口 8080 |
| `frontend/Dockerfile.nginx` | 前端（Next.js + Nginx） | 端口 80 |
| `frontend/Dockerfile` | 前端（纯 Next.js） | 端口 3000 |
| `backend/Dockerfile.dev` | 后端开发模式 | 支持热重载 |
| `frontend/Dockerfile.dev` | 前端开发模式 | 支持热重载 |

#### 构建参数和环境变量

在构建镜像时，可以通过 `--build-arg` 传递构建参数：

```bash
# 示例：自定义 Node.js 内存限制
docker build \
  --build-arg NODE_OPTIONS="--max-old-space-size=4096" \
  -t mailman-frontend:local \
  -f frontend/Dockerfile.nginx \
  frontend/
```

#### 推送到私有仓库

```bash
# 标记镜像
docker tag mailman-all:local your-registry.com/mailman-all:v1.0.0

# 登录私有仓库
docker login your-registry.com

# 推送镜像
docker push your-registry.com/mailman-all:v1.0.0
```

#### 离线部署

```bash
# 导出镜像
docker save mailman-all:local -o mailman-all.tar

# 传输到目标机器后导入
docker load -i mailman-all.tar

# 运行
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  mailman-all:local
```

---

### 方式四：本地源码开发

适合开发者进行调试和二次开发。

#### 1. 环境准备

```bash
# 验证环境
go version    # 需要 Go 1.23+
node --version  # 需要 Node.js 18+
npm --version
```

#### 2. 克隆项目

```bash
git clone https://github.com/seongminhwan/mailman.git
cd mailman
```

#### 3. 配置后端

```bash
cd backend

# 创建环境配置（使用 SQLite，无需额外数据库）
cat > .env << 'EOF'
# 数据库配置
DB_DRIVER=sqlite
DB_NAME=./mailman.db

# 服务器配置
SERVER_HOST=0.0.0.0
SERVER_PORT=8080

# 日志级别
LOG_LEVEL=DEBUG
EOF

# 安装依赖并启动
go mod download
go run ./cmd/mailman/main.go
```

#### 4. 配置前端（新终端窗口）

```bash
cd frontend

# 创建环境配置
cat > .env.local << 'EOF'
NEXT_PUBLIC_API_URL=http://localhost:8080
EOF

# 安装依赖并启动
npm install
npm run dev
```

#### 5. 访问地址

- **前端界面**: http://localhost:3000
- **后端 API**: http://localhost:8080
- **API 文档**: http://localhost:8080/swagger/index.html

---

## 环境变量配置

### 后端环境变量

#### 服务器配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `SERVER_HOST` | 服务监听地址 | `localhost` | `0.0.0.0` |
| `SERVER_PORT` | 服务监听端口 | `8080` | `8080` |
| `LOG_LEVEL` | 日志级别 | `INFO` | `DEBUG`, `INFO`, `WARN`, `ERROR` |

#### 数据库配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `DB_DRIVER` | 数据库驱动 | `sqlite` | `sqlite`, `mysql`, `postgres` |
| `DB_NAME` | 数据库名/文件路径 | `mailman.db` | `./mailman.db` 或 `mailman` |
| `DB_HOST` | 数据库主机 | `localhost` | `mysql`, `127.0.0.1` |
| `DB_PORT` | 数据库端口 | `5432` | MySQL: `3306`, PostgreSQL: `5432` |
| `DB_USER` | 数据库用户 | `mailman` | `mailman` |
| `DB_PASSWORD` | 数据库密码 | *(空)* | `your_password` |
| `DB_SSLMODE` | SSL 模式 | `disable` | `disable`, `require` |

#### OAuth2 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `GMAIL_REDIRECT_URI` | Gmail OAuth2 回调地址 | `http://localhost:8080/api/oauth2/callback/gmail` |
| `OUTLOOK_REDIRECT_URI` | Outlook OAuth2 回调地址 | `http://localhost:8080/api/oauth2/callback/outlook` |

> **注意**: OAuth2 的 Client ID 和 Client Secret 现在通过 Web 界面的「设置 → OAuth2 配置」进行配置，无需在环境变量中设置。

#### AI 服务配置

> **注意**: AI 服务配置已改为通过 Web 界面管理，位于「设置 → AI 配置」页面。环境变量配置方式已废弃。

### 前端环境变量

| 变量名 | 说明 | 默认值 | 生产环境 |
|--------|------|--------|----------|
| `NEXT_PUBLIC_API_URL` | 后端 API 地址 | *(空)* | 使用相对路径（由 Nginx 代理）|
| `NEXT_PUBLIC_API_BASE_URL` | 完整 API 基础 URL | `http://localhost:8080` | 同上 |
| `NODE_ENV` | 运行环境 | `development` | `production` |

### 日志配置

#### 日志级别 (`LOG_LEVEL`)

| 级别 | 说明 | 输出内容 |
|------|------|----------|
| `DEBUG` | 调试模式 | 所有日志，包括 HTTP 请求/响应详情 |
| `INFO` | 信息模式（默认） | 一般运行信息 |
| `WARN` | 警告模式 | 警告和错误信息 |
| `ERROR` | 错误模式 | 仅错误信息 |

#### 日志静默前缀 (`LOG_QUIET_PREFIXES`)

用于减少特定模块的日志输出，提高日志可读性。

```bash
# 格式：多个前缀用逗号分隔
LOG_QUIET_PREFIXES="FetcherService,AccountSyncer"
```

**常用静默前缀**:
- `FetcherService` - 邮件抓取服务日志
- `AccountSyncer` - 账户同步服务日志

**启动示例**:
```bash
# 开发时减少同步相关日志
LOG_QUIET_PREFIXES="FetcherService,AccountSyncer" ./mailman
```

---

## 首次登录与用户注册

### 🔐 重要说明

Mailman 采用**首次登录自动注册**机制：

1. **首次访问**: 打开 http://localhost:8080，进入登录页面
2. **输入凭证**: 输入您想要使用的用户名和密码
3. **自动注册**: 如果系统中没有任何用户，首次登录会自动创建管理员账户
4. **后续登录**: 使用您设置的凭证正常登录

> ⚠️ **安全提示**: 首次部署后请立即设置一个强密码的账户，避免被他人抢先注册。

### 推荐操作流程

```text
1. 部署完成后立即访问系统
2. 使用安全的用户名和强密码进行首次登录
3. 该账户将成为系统的第一个（管理员）用户
4. 进入「设置」完成系统配置
```

---

## 后续配置

### 1. 配置 OAuth2（可选，用于 Gmail/Outlook）

系统支持通过 OAuth2 连接 Gmail 和 Outlook 邮箱。

| 提供商 | 控制台 | 回调 URI |
|--------|--------|----------|
| Gmail | [Google Cloud Console](https://console.cloud.google.com/) | `http://your-domain/api/oauth2/callback/gmail` |
| Outlook | [Azure Portal](https://portal.azure.com/) | `http://your-domain/api/oauth2/callback/outlook` |

**配置步骤**:
1. 在对应云平台创建 OAuth2 应用
2. 获取 Client ID 和 Client Secret
3. 在 Mailman「设置 → OAuth2 配置」中添加配置
4. 添加邮件账户时选择对应的 OAuth2 配置

> 📖 详细指南请参阅 [`docs/oauth2-setup-guide.md`](./docs/oauth2-setup-guide.md)

### 2. 配置 AI 服务（可选）

支持的 AI 提供商：
- OpenAI (GPT-3.5, GPT-4)
- Claude (Anthropic)
- Gemini (Google)

**配置步骤**:
1. 进入「设置 → AI 配置」
2. 点击「添加 AI 配置」
3. 选择提供商，输入 API 密钥
4. 测试连接后保存

### 3. 添加邮件账户

支持的邮件类型：
- Gmail (通过 OAuth2)
- Outlook (通过 OAuth2)
- 通用 IMAP/SMTP
- Exchange Server

---

## 常用运维命令

### Docker 一键部署

```bash
# 查看容器状态
docker ps

# 查看日志
docker logs mailman
docker logs -f mailman  # 实时查看
docker logs --tail 100 mailman  # 最近 100 行

# 重启服务
docker restart mailman

# 停止服务
docker stop mailman

# 启动服务
docker start mailman

# 删除容器（数据保留）
docker rm mailman

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

### Docker Compose

```bash
# 查看状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 重启服务
docker-compose restart

# 停止服务
docker-compose down

# 更新服务
git pull
docker-compose pull
docker-compose up -d
```

### 本地开发

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

# 前端开发模式
npm run dev
```

### 密码重置

如果忘记密码，可使用后端提供的密码重置工具：

```bash
cd backend

# 构建重置工具
make reset-password

# 使用用户名重置
./reset-password -username=admin -password=new_password -force

# 使用邮箱重置
./reset-password -email=admin@example.com -password=new_password -force

# 交互式重置（更安全）
./reset-password -username=admin
```

### 数据备份

```bash
# Docker 部署备份
docker run --rm \
  -v mailman_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/mailman-backup-$(date +%Y%m%d).tar.gz /data

# Docker 部署恢复
docker run --rm \
  -v mailman_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/mailman-backup-YYYYMMDD.tar.gz -C /

# 本地开发备份（SQLite）
cp backend/mailman.db backend/mailman.db.backup
```

---

## 故障排除

### 端口被占用

```bash
# 检查端口占用
lsof -i :8080
netstat -an | grep 8080

# 解决方案 1: 终止占用进程
kill -9 <PID>

# 解决方案 2: 使用其他端口
docker run -d --name mailman -p 9000:80 ...
```

### 容器无法启动

```bash
# 检查容器日志
docker logs mailman

# 强制删除容器
docker rm -f mailman

# 重新启动
docker run -d ...
```

### 无法连接数据库

```bash
# 检查数据库配置
echo $DB_DRIVER
echo $DB_HOST

# SQLite: 确保数据库文件路径可写
ls -la ./mailman.db

# MySQL: 测试连接
mysql -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME
```

### API 连接失败

```bash
# 检查后端服务
curl http://localhost:8080/health

# 检查 API 响应
curl http://localhost:8080/api/system/info
```

### 前端页面空白

```bash
# 检查前端构建
cd frontend
npm run build

# 检查 Next.js 服务
npm run dev

# 检查 API 代理配置
# 确保 next.config.js 中的 rewrites 配置正确
```

---

## 架构说明

### Docker 一键部署架构

```
                        ┌─────────────────────────────────────────────┐
                        │           Docker 容器 (All-in-One)          │
                        │                                             │
  用户请求 ─────────────►│  ┌─────────┐                               │
        :80             │  │  Nginx  │                               │
                        │  └────┬────┘                               │
                        │       │                                     │
                        │       ├──── /api/ ────► Backend (8081)     │
                        │       │                                     │
                        │       ├──── /ws ──────► Backend (8081)     │
                        │       │                                     │
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

### Docker Compose 架构

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                        Docker Network                           │
  │                                                                 │
  │  ┌───────────┐      ┌───────────┐      ┌───────────────┐       │
  │  │  Frontend │ ───► │  Backend  │ ───► │     MySQL     │       │
  │  │  (Nginx)  │      │    (Go)   │      │     (8.0)     │       │
  │  └─────┬─────┘      └───────────┘      └───────────────┘       │
  │        │                                                        │
  └────────┼────────────────────────────────────────────────────────┘
           │
           ▼
       用户 (:80)
```

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [`README.md`](./README.md) | 项目总览和快速开始 |
| [`INSTALL.md`](./INSTALL.md) | 安装指南 |
| [`QUICK-START.md`](./QUICK-START.md) | 5分钟快速开始 |
| [`docs/oauth2-setup-guide.md`](./docs/oauth2-setup-guide.md) | OAuth2 配置详细指南 |
| [`K3S_QUICKSTART.md`](./K3S_QUICKSTART.md) | K3s 部署指南 |
| [`HELM_DEPLOYMENT.md`](./HELM_DEPLOYMENT.md) | Kubernetes Helm 部署 |

---

## 版本历史

| 日期 | 版本 | 更新内容 |
|------|------|----------|
| 2025-12-28 | v1.0 | 初始创建，整合所有部署方式和配置说明 |
| 2025-12-28 | v1.1 | 添加本地构建 Docker 镜像完整教程 |

---

**Mailman** - 智能邮件管理系统 🚀
