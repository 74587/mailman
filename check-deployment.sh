#!/bin/bash

# Mailman 部署检查脚本
# 检查系统是否满足部署要求

echo "🔍 Mailman 部署环境检查"
echo "=================================="

# 检查 Docker
echo "📦 检查 Docker..."
if command -v docker &> /dev/null; then
    echo "✅ Docker 已安装: $(docker --version)"

    # 检查 Docker 是否运行
    if docker info &> /dev/null; then
        echo "✅ Docker 服务正在运行"
    else
        echo "❌ Docker 服务未运行，请启动 Docker"
        echo "💡 解决方案:"
        echo "   - macOS: 打开 Docker Desktop 应用"
        echo "   - Linux: sudo systemctl start docker"
        echo "   - Windows: 打开 Docker Desktop"
        exit 1
    fi
else
    echo "❌ Docker 未安装"
    echo "💡 请访问 https://docs.docker.com/get-docker/ 安装 Docker"
    exit 1
fi

# 检查端口占用
echo ""
echo "🔌 检查端口占用..."
if command -v netstat &> /dev/null; then
    if netstat -tuln | grep -q ":8080 "; then
        echo "⚠️  端口 8080 被占用"
        echo "💡 可以使用其他端口，例如:"
        echo "   docker run -d --name mailman -p 8081:80 ghcr.io/seongminhwan/mailman-all:latest"
    else
        echo "✅ 端口 8080 可用"
    fi
else
    echo "⚠️  无法检查端口占用（netstat 命令不可用）"
fi

# 检查磁盘空间
echo ""
echo "💾 检查磁盘空间..."
if command -v df &> /dev/null; then
    available_space=$(df . | tail -1 | awk '{print $4}')
    if [ "$available_space" -gt 1048576 ]; then  # 1GB in KB
        echo "✅ 磁盘空间充足"
    else
        echo "⚠️  磁盘空间可能不足，建议至少 1GB 可用空间"
    fi
else
    echo "⚠️  无法检查磁盘空间"
fi

# 检查网络连接
echo ""
echo "🌐 检查网络连接..."
if curl -s --connect-timeout 5 https://ghcr.io &> /dev/null; then
    echo "✅ 可以访问 GitHub Container Registry"
else
    echo "⚠️  无法访问 GitHub Container Registry"
    echo "💡 请检查网络连接或代理设置"
fi

echo ""
echo "🎉 环境检查完成！"
echo ""
echo "🚀 现在可以部署 Mailman："
echo ""
echo "Docker 一键部署:"
echo "docker run -d \\"
echo "  --name mailman \\"
echo "  -p 8080:80 \\"
echo "  -v mailman_data:/app/data \\"
echo "  --restart unless-stopped \\"
echo "  ghcr.io/seongminhwan/mailman-all:latest"
echo ""
echo "部署完成后访问: http://localhost:8080"
echo "首次登录时输入您想使用的用户名和密码，系统将自动创建管理员账户"