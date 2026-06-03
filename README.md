# 📧 Mailman - 智能邮件管理系统

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker Image](https://img.shields.io/docker/pulls/seongminhwan/mailman-all.svg)](https://hub.docker.com/r/seongminhwan/mailman-all)
[![Go Version](https://img.shields.io/badge/Go-1.23+-blue.svg)](https://golang.org)
[![Next.js](https://img.shields.io/badge/Next.js-14.0+-black.svg)](https://nextjs.org)

Mailman 是一个现代化的智能邮件管理系统，提供多账户邮件同步、OAuth2 认证、AI 内容分析和自动化触发器等功能。

## ✨ 主要特性

- **多账户管理**：Gmail (OAuth2)、Outlook (OAuth2)、IMAP/SMTP、Exchange
- **AI 智能分析**：支持 OpenAI、Claude、Gemini 多种 AI 驱动的邮件内容提取
- **邮件触发器**：基于条件自动执行操作的规则引擎
- **实时同步**：WebSocket 实时推送，自动定期同步
- **安全可靠**：OAuth2 认证、数据加密、HTTPS 支持
- **多架构支持**：AMD64、ARM64、ARM/v7（树莓派）

## 🚀 快速开始

```bash
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  ghcr.io/seongminhwan/mailman-all:latest
```

访问 **http://localhost:8080**。首次登录时输入用户名和密码，系统将自动创建管理员账户。

## 🏗️ 技术架构

| 组件 | 技术栈 |
|------|--------|
| **后端** | Go 1.23+, Gorilla Mux, GORM |
| **前端** | Next.js 14, TypeScript, Tailwind CSS, Radix UI |
| **数据库** | SQLite (默认) / MySQL 8.0+ |
| **部署** | Docker, Docker Compose, Kubernetes/Helm |

## 📖 部署方式

| 方式 | 复杂度 | 时间 |
|------|--------|------|
| Docker 一键部署 | ⭐ | 2分钟 |
| Docker Compose | ⭐⭐ | 5分钟 |
| K3s 轻量集群 | ⭐⭐ | 5分钟 |
| Kubernetes / Helm | ⭐⭐⭐ | 10分钟 |
| 源码开发 | ⭐⭐⭐⭐ | 15分钟 |

📖 **详细部署指南**：[docs/deployment.md](./docs/deployment.md)

## 📋 项目结构

```
mailman/
├── backend/                   # Go 后端服务
│   ├── cmd/mailman/          # 应用入口
│   ├── internal/             # 内部包 (api, models, services, repository)
│   └── Dockerfile
├── frontend/                  # Next.js 前端
│   ├── src/                  # 源代码 (app, components, services)
│   ├── Dockerfile.nginx
│   └── package.json
├── docs/                     # 文档
│   └── deployment.md         # 统一部署指南
├── helm/                     # Kubernetes Helm Chart
├── docker-compose.yml        # Docker Compose 配置
└── README.md
```

## 🛠️ 本地开发

```bash
# 克隆项目
git clone https://github.com/seongminhwan/mailman.git
cd mailman

# 启动后端
cd backend
go mod download
go run cmd/mailman/main.go

# 启动前端（新终端）
cd frontend
npm install
npm run dev
```

- 前端：http://localhost:3000
- 后端：http://localhost:8080
- API 文档：http://localhost:8080/swagger/index.html

## 🔧 配置

### OAuth2（Gmail / Outlook）

通过 Web 界面「设置 → OAuth2 配置」添加 Gmail 和 Outlook 的 OAuth2 凭据。

📖 详见 [docs/deployment.md#7-oauth2-配置](./docs/deployment.md#7-oauth2-配置)

### AI 服务

通过 Web 界面「设置 → AI 配置」添加 OpenAI、Claude 或 Gemini 的 API 密钥。

### 代理池与代理网关

通过 Web 界面「代理池管理」维护上游代理、HTTP / SOCKS5 网关、网关用户、安全策略、DNS 策略和用户名路由。

📖 详见 [docs/proxy-pool-management-guide.md](./docs/proxy-pool-management-guide.md)

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 🆘 获取帮助

- 📖 **部署指南**：[docs/deployment.md](./docs/deployment.md)
- 🐛 **问题报告**：[GitHub Issues](https://github.com/seongminhwan/mailman/issues)

---

**Mailman** - 让邮件管理更智能、更高效！ 🚀
