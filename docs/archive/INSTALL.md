# 🚀 Mailman 安装指南

> **注意**：这是一个全新的简化安装指南，解决了原文档中的问题，确保用户能够成功部署项目。

## 📋 快速选择（推荐）

| 安装方式 | 适合人群 | 复杂度 | 时间 | 推荐指数 |
|---------|----------|--------|------|----------|
| **🔥 Docker 一键部署** | 新手、快速体验 | ⭐ | 2分钟 | ⭐⭐⭐⭐⭐ |
| **Docker Compose** | 生产环境 | ⭐⭐ | 5分钟 | ⭐⭐⭐⭐ |
| **源码开发** | 开发者 | ⭐⭐⭐⭐ | 15分钟 | ⭐⭐⭐ |

---

## 🔥 方式一：Docker 一键部署（强烈推荐）

这是最简单、最可靠的部署方式，只需要一条命令。

### 前置要求
- 安装 [Docker](https://docs.docker.com/get-docker/)（任何操作系统）

### 一键部署命令

```bash
# 直接运行（使用内置 SQLite 数据库）
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  ghcr.io/seongminhwan/mailman-all:latest
```

### 🏗️ 多架构支持

我们的 Docker 镜像支持多种架构，Docker 会自动选择适合您系统的架构：

| 架构 | 平台 | 说明 |
|------|------|------|
| **linux/amd64** | Intel/AMD 64-bit | 台式机、服务器 |
| **linux/arm64** | ARM 64-bit | Apple Silicon (M1/M2/M3)、ARM 服务器 |
| **linux/arm/v7** | ARM 32-bit | 树莓派、ARM 设备 |

### 🔧 平台特定部署

#### Apple Silicon (M1/M2/M3) Mac
Docker 会自动选择 ARM64 架构：
```bash
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  ghcr.io/seongminhwan/mailman-all:latest
```

#### 树莓派 (ARM32)
需要明确指定 ARM32 架构：
```bash
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --platform linux/arm/v7 \
  ghcr.io/seongminhwan/mailman-all:latest
```

#### 普通 PC/服务器 (Intel/AMD)
Docker 会自动选择 AMD64 架构：
```bash
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  ghcr.io/seongminhwan/mailman-all:latest
```

### 🔍 验证架构

查看下载的镜像架构：
```bash
docker inspect ghcr.io/seongminhwan/mailman-all:latest | grep Architecture
```

### 访问应用
- **前端界面**：http://localhost:8080
- **API 文档**：http://localhost:8080/swagger/index.html

### 常用管理命令

```bash
# 查看状态
docker ps

# 查看日志
docker logs mailman

# 停止服务
docker stop mailman

# 启动服务
docker start mailman

# 删除服务（数据会保留）
docker rm mailman

# 更新到最新版本
docker stop mailman && docker rm mailman
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  ghcr.io/seongminhwan/mailman-all:latest
```

### 数据备份

```bash
# 备份数据
docker run --rm -v mailman_data:/data -v $(pwd):/backup alpine tar czf /backup/mailman-backup.tar.gz /data

# 恢复数据
docker run --rm -v mailman_data:/data -v $(pwd):/backup alpine tar xzf /backup/mailman-backup.tar.gz -C /
```

---

## 🏭 方式二：Docker Compose 部署

适合生产环境，服务分离，性能更好。

### 前置要求
- Docker 和 Docker Compose

### 快速部署

```bash
# 1. 克隆项目
git clone https://github.com/seongminhwan/mailman.git
cd mailman

# 2. 创建环境配置文件
cat > .env << EOF
# 数据库配置
MYSQL_ROOT_PASSWORD=root_password_123
MYSQL_DATABASE=mailman
MYSQL_USER=mailman
MYSQL_PASSWORD=mailman_password_456
EOF

# 3. 启动服务
docker-compose up -d

# 4. 查看状态
docker-compose ps
```

### 访问应用
- **前端界面**：http://localhost:80
- **后端 API**：http://localhost:8080

### 管理命令

```bash
# 查看日志
docker-compose logs -f

# 重启服务
docker-compose restart

# 停止服务
docker-compose down

# 停止并删除数据（慎用）
docker-compose down -v

# 更新服务
git pull origin main
docker-compose pull
docker-compose up -d
```

---

## 💻 方式三：源码开发部署

适��开发者，需要本地环境。

### 前置要求
- Go 1.23+
- Node.js 18+
- MySQL 8.0+ 或 SQLite

### 安装步骤

```bash
# 1. 克隆项目
git clone https://github.com/seongminhwan/mailman.git
cd mailman

# 2. 启动数据库（二选一）

# 选择A：使用 Docker 启动 MySQL
docker run -d \
  --name mailman-dev-db \
  -e MYSQL_ROOT_PASSWORD=root123 \
  -e MYSQL_DATABASE=mailman \
  -e MYSQL_USER=mailman \
  -e MYSQL_PASSWORD=mailman123 \
  -p 3306:3306 \
  mysql:8.0

# 选择B：使用 SQLite（无需额外数据库）
# 跳过此步骤，直接使用默认配置

# 3. 配置后端环境
cd backend

# 创建后端环境配置
cat > .env << EOF
# 数据库配置
DB_DRIVER=sqlite
DB_NAME=./mailman.db

# 或者使用 MySQL（如果启动了 MySQL 容器）
# DB_DRIVER=mysql
# DB_HOST=localhost
# DB_PORT=3306
# DB_USER=mailman
# DB_PASSWORD=mailman123
# DB_NAME=mailman

# 服务器配置
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
LOG_LEVEL=DEBUG
EOF

# 4. 启动后端
go mod download
go run cmd/mailman/main.go

# 5. 配置前端环境（新终端）
cd frontend

# 创建前端环境配置
cat > .env.local << EOF
NEXT_PUBLIC_API_URL=http://localhost:8080
EOF

# 6. 启动前端
npm install
npm run dev
```

### 访问应用
- **前端界面**：http://localhost:3000
- **后端 API**：http://localhost:8080

---

## ⚙️ 首次配置指南

### 1. 登录系统
首次访问时，使用默认账户登录：
- 用户名：`admin`
- 密码：`admin123`

### 2. 配置 OAuth2（Gmail/Outlook）

#### Gmail 配置：
1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建项目并启用 Gmail API
3. 创建 OAuth2 客户端 ID
4. 添加重定向 URI：`http://localhost:8080/api/oauth2/callback/gmail`
5. 在系统中添加 OAuth2 配置

#### Outlook 配置：
1. 访问 [Azure Portal](https://portal.azure.com/)
2. 注册应用程序
3. 添加 API 权限
4. 添加重定向 URI：`http://localhost:8080/api/oauth2/callback/outlook`
5. 在系统中添加 OAuth2 配置

### 3. 配置 AI 服务（可选）
1. 进入"设置" → "AI配置"
2. 添加 AI 服务提供商（OpenAI、Claude、Gemini）
3. 输入 API 密钥并测试连接

### 4. 添加邮件账户
1. 进入"邮件账户"页面
2. 点击"添加账户"
3. 选择邮件类型并配置连接信息

---

## ❓ 常见问题

### Q: 端口被占用怎么办？
```bash
# 使用其他端口，例如 8081
docker run -d --name mailman -p 8081:80 ghcr.io/seongminhwan/mailman-all:latest
# 然后访问 http://localhost:8081
```

### Q: 忘记密码怎么办？
```bash
# 重置为默认配置
docker stop mailman && docker rm mailman
# 重新运行部署命令，使用默认账户登录
```

### Q: 如何查看日志？
```bash
# 实时查看日志
docker logs -f mailman

# 查看最近的日志
docker logs --tail 100 mailman
```

### Q: 数据存储在哪里？
- **Docker 部署**：存储在 Docker volume `mailman_data` 中
- **源码部署**：SQLite 文件在 `backend/mailman.db`

### Q: 如何备份数据？
见上文的"数据备份"部分

---

## 🛠️ 故障排除

### 1. 容器无法启动
```bash
# 检查端口占用
netstat -tulpn | grep :8080

# 强制删除容器
docker rm -f mailman

# 重新运行
```

### 2. 无法访问前端
```bash
# 检查容器状态
docker ps

# 检查容器内部服务
docker exec mailman curl http://localhost:80
```

### 3. API 连接失败
```bash
# 检查后端服务
curl http://localhost:8080/health

# 如果是 Docker Compose，检查网络
docker-compose ps
```

---

## 📞 获取帮助

如果遇到问题：

1. **查看日志**：`docker logs mailman`
2. **检查配置**：确认环境变量设置正确
3. **重启服务**：`docker restart mailman`
4. **提交 Issue**：[GitHub Issues](https://github.com/seongminhwan/mailman/issues)

---

## ✅ 验证安装成功

安装成功后，你应该能够：

1. ✅ 访问 http://localhost:8080 看到登录界面
2. ✅ 使用 admin/admin123 登录
3. ✅ 看到"仪表板"页面
4. ✅ 访问 http://localhost:8080/swagger/index.html 看到 API 文档

如果以上步骤都能成功，恭喜你！Mailman 已经成功部署了！🎉

---

**💡 提示**：推荐使用 Docker 一键部署，这是最简单可靠的方式。