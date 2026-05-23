# ⚡ Mailman 5分钟快速开始

> 适用于新手和快速体验的简化指南

## 🎯 ���标
在 5 分钟内完成 Mailman 的部署并成功访问系统。

## 🔥 一键部署（2分钟）

### 前置要求
- 安装 [Docker](https://docs.docker.com/get-docker/)（任何系统）

### 部署命令
复制并运行以下命令：

```bash
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  ghcr.io/seongminhwan/mailman-all:latest
```

### 🏗️ 多平台支持

Docker 会自动选择适合您系统架构的镜像：

- **Intel/AMD 电脑** → 自动使用 `linux/amd64`
- **Apple Silicon Mac (M1/M2/M3)** → 自动使用 `linux/arm64`
- **树莓派** → 需要指定 `--platform linux/arm/v7`

**树莓派用户请使用：**
```bash
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --platform linux/arm/v7 \
  ghcr.io/seongminhwan/mailman-all:latest
```

### 访问系统
打开浏览器访问：**http://localhost:8080**

### 登录系统
- 用户名：`admin`
- 密码：`admin123`

## ✅ 验证安装成功

看到以下页面说明安装成功：

1. ✅ **登录页面**：http://localhost:8080
2. ✅ **仪表板**：登录后看到主界面
3. ✅ **API文档**：http://localhost:8080/swagger/index.html

## 📧 添加第一个邮件账户

### 添加 Gmail 账户

1. **启用 Gmail API**：
   - 访问 [Google Cloud Console](https://console.cloud.google.com/)
   - 创建新项目或选择现有项目
   - 启用 Gmail API
   - 创建 OAuth2 客户端 ID
   - 添加重定向 URI：`http://localhost:8080/api/oauth2/callback/gmail`

2. **在系统中添加账户**：
   - 点击左侧菜单"邮件账户"
   - 点击"添加账户"
   - 选择"Gmail"
   - 输入 Gmail 地址和密码
   - 测试连接并保存

### 添加 Outlook 账户

1. **配置 Outlook OAuth2**：
   - 访问 [Azure Portal](https://portal.azure.com/)
   - 注册新应用程序
   - 添加 API 权限（Mail.Read, Mail.Send）
   - 添加重定向 URI：`http://localhost:8080/api/oauth2/callback/outlook`

2. **在系统中添加账户**：
   - 操作同 Gmail，选择"Outlook"

## 🤖 配置 AI 服务（可选）

1. 获取 OpenAI API 密钥：
   - 访问 [OpenAI Platform](https://platform.openai.com/)
   - 创建 API 密钥

2. 在系统中配置：
   - 点击左侧菜单"设置"
   - 选择"AI配置"
   - 点击"添加AI配置"
   - 选择"OpenAI"
   - 输入 API 密钥
   - 测试连接并保存

## 🛠️ 常用管理

### 查看状态
```bash
docker ps
```

### 查看日志
```bash
docker logs mailman
```

### 重启服务
```bash
docker restart mailman
```

### 停止服务
```bash
docker stop mailman
```

### 更新版本
```bash
docker stop mailman && docker rm mailman
docker run -d \
  --name mailman \
  -p 8080:80 \
  -v mailman_data:/app/data \
  --restart unless-stopped \
  ghcr.io/seongminhwan/mailman-all:latest
```

## ❓ 常见问题

**Q: 端口被占用怎么办？**
```bash
# 使用其他端口，比如 8081
docker run -d --name mailman -p 8081:80 ghcr.io/seongminhwan/mailman-all:latest
# 然后访问 http://localhost:8081
```

**Q: 忘记密码怎么办？**
```bash
# 删除容器重新部署
docker stop mailman && docker rm mailman
# 重新运行部署命令，使用默认密码 admin/admin123
```

**Q: 数据存储在哪里？**
- 数据存储在 Docker volume `mailman_data` 中
- 更新容器时数据不会丢失

**Q: 如何备份数据？**
```bash
# 备份数据到当前目录
docker run --rm -v mailman_data:/data -v $(pwd):/backup alpine tar czf /backup/mailman-backup.tar.gz /data
```

## 🎉 恭喜！

如果你能成功访问系统并看到仪表板，说明 Mailman 已经成功部署！

现在你可以：
- ✅ 添加邮件账户
- ✅ 同步邮件
- ✅ 配置 AI 服务
- ✅ 设置邮件触发器

## 📚 更多文档

- 📖 **完整安装指南**：[`INSTALL.md`](./INSTALL.md)
- 🏗️ **技术文档**：[`README.md`](./README.md)
- 🐛 **问题反馈**：[GitHub Issues](https://github.com/seongminhwan/mailman/issues)

---

**享受使用 Mailman！** 🚀