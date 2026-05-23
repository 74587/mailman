# Mailman K3s 快速开始指南

⚡ 5分钟快速在 K3s 集群上部署 Mailman 邮箱管理系统

## 🎯 一键部署

### 方式一：使用部署脚本（推荐）

```bash
# 1. 确保 K3s 已安装并运行
curl -sfL https://get.k3s.io | sh -

# 2. 运行部署脚本
./deploy-k3s.sh

# 3. 访问应用
# 脚本会自动显示访问地址，例如: http://localhost:30080
```

就这么简单！🎉

### 方式二：手动部署

```bash
# 1. 部署数据库
kubectl apply -f ./helm/mailman/matrixdb-deployment.yaml
kubectl wait --for=condition=ready pod -l app=mariadb --timeout=300s

# 2. 部署应用
helm install mailman ./helm/mailman \
  --values ./helm/mailman/values-matrixdb-production.yaml \
  --values ./helm/mailman/values-k3s.yaml

# 3. 配置访问
kubectl patch svc mailman-frontend -p '{"spec":{"type":"NodePort"}}'

# 4. 获取访问端口
kubectl get svc mailman-frontend
```

## 📋 前置要求

| 项目 | 要求 | 检查命令 |
|------|------|----------|
| K3s | v1.24+ | `k3s --version` |
| Helm | v3.8+ | `helm version` |
| kubectl | 已配置 | `kubectl get nodes` |
| 系统资源 | 2GB RAM, 2 CPU | - |

### 快速安装 K3s

```bash
# 标准安装
curl -sfL https://get.k3s.io | sh -

# 配置 kubectl
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config

# 验证
kubectl get nodes
```

### 快速安装 Helm

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

## 🚀 部署选项

### 选项 1: 标准配置（生产环境）

```bash
helm install mailman ./helm/mailman \
  --values ./helm/mailman/values-matrixdb-production.yaml
```

- 资源: Backend 1Gi, Frontend 512Mi
- 适用: 标准生产环境

### 选项 2: K3s 优化配置（推荐）

```bash
helm install mailman ./helm/mailman \
  --values ./helm/mailman/values-matrixdb-production.yaml \
  --values ./helm/mailman/values-k3s.yaml
```

- 资源: Backend 512Mi, Frontend 256Mi
- 适用: 边缘计算、开发环境
- 特性: 启用 local-path 存储、Traefik Ingress

### 选项 3: 本地测试配置

```bash
helm install mailman ./helm/mailman \
  --values ./helm/mailman/values-local-test.yaml
```

- 资源: 最小配置
- 适用: 本地开发测试

## 🌐 访问方式

### 方式 1: NodePort（最简单）

```bash
# 自动配置
kubectl patch svc mailman-frontend -p '{"spec":{"type":"NodePort"}}'

# 获取端口
PORT=$(kubectl get svc mailman-frontend -o jsonpath='{.spec.ports[0].nodePort}')
echo "访问地址: http://localhost:$PORT"
```

### 方式 2: Traefik Ingress（推荐）

```bash
# 创建 Ingress
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

# 配置 hosts
echo "127.0.0.1 mailman.local" | sudo tee -a /etc/hosts

# 访问
# http://mailman.local
```

### 方式 3: 端口转发（调试）

```bash
kubectl port-forward svc/mailman-frontend 8080:80

# 访问 http://localhost:8080
```

## ✅ 验证部署

```bash
# 检查 Pod 状态
kubectl get pods -l app.kubernetes.io/name=mailman

# 应该看到类似输出:
# NAME                               READY   STATUS    RESTARTS   AGE
# mailman-backend-xxx               1/1     Running   0          2m
# mailman-frontend-xxx              1/1     Running   0          2m

# 检查服务
kubectl get svc

# 测试健康检查
kubectl run curl-test --image=curlimages/curl --rm -it --restart=Never -- \
  curl http://mailman-backend:8080/api/health
```

## 🔧 常用操作

### 查看日志

```bash
# 后端日志
kubectl logs -f deployment/mailman-backend

# 前端日志
kubectl logs -f deployment/mailman-frontend

# 数据库日志
kubectl logs -f -l app=mariadb
```

### 重启服务

```bash
kubectl rollout restart deployment/mailman-backend
kubectl rollout restart deployment/mailman-frontend
```

### 扩缩容

```bash
# 手动扩容
kubectl scale deployment mailman-backend --replicas=2
kubectl scale deployment mailman-frontend --replicas=2

# 查看状态
kubectl get deployments
```

### 更新配置

```bash
# 更新应用
helm upgrade mailman ./helm/mailman \
  --values ./helm/mailman/values-matrixdb-production.yaml \
  --values ./helm/mailman/values-k3s.yaml

# 查看历史
helm history mailman

# 回滚
helm rollback mailman
```

## 🐛 故障排查

### Pod 无法启动

```bash
# 查看 Pod 详情
kubectl describe pod -l app.kubernetes.io/name=mailman

# 查看事件
kubectl get events --sort-by='.lastTimestamp' | tail -20

# 检查镜像
kubectl get pods -o jsonpath='{.items[*].spec.containers[*].image}'
```

### 无法访问应用

```bash
# 检查服务
kubectl get svc mailman-frontend

# 测试内部连接
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://mailman-frontend

# 检查 Ingress
kubectl describe ingress mailman-ingress
```

### 数据库连接失败

```bash
# 检查 MariaDB
kubectl get pods -l app=mariadb
kubectl logs -l app=mariadb

# 测试数据库连接
kubectl exec -it deployment/mailman-backend -- \
  nc -zv mariadb 3306
```

## 🧹 卸载

### 使用脚本卸载

```bash
./deploy-k3s.sh cleanup
```

### 手动卸载

```bash
# 卸载应用
helm uninstall mailman

# 删除数据库
kubectl delete -f ./helm/mailman/matrixdb-deployment.yaml

# 可选: 删除数据（谨慎！）
kubectl delete pvc mariadb-pvc
```

## 📊 监控状态

### 使用脚本

```bash
./deploy-k3s.sh status
```

### 手动查看

```bash
# 全局概览
kubectl get all -l app.kubernetes.io/name=mailman

# 资源使用
kubectl top pods -l app.kubernetes.io/name=mailman
kubectl top nodes

# 详细信息
kubectl describe deployment mailman-backend
kubectl describe deployment mailman-frontend
```

## 🔐 安全建议

### 生产环境部署前

1. **修改默认密码**
```bash
# 生成新密码
NEW_PASSWORD=$(openssl rand -base64 32)

# 更新密码 (编辑 matrixdb-deployment.yaml)
kubectl edit deployment -l app=mariadb
```

2. **配置 HTTPS**
```bash
# 安装 cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# 配置 TLS Ingress (见 K3S_DEPLOYMENT.md)
```

3. **启用 NetworkPolicy**
```bash
# 编辑 values 启用网络策略
helm upgrade mailman ./helm/mailman \
  --set networkPolicy.enabled=true
```

## 🎓 下一步

- 📖 阅读完整文档: [`K3S_DEPLOYMENT.md`](K3S_DEPLOYMENT.md)
- 🔧 配置 OAuth2: 通过前端页面动态添加
- 📊 设置监控: Prometheus + Grafana
- 🔐 配置 HTTPS: cert-manager + Let's Encrypt

## 🆘 获取帮助

```bash
# 查看部署脚本帮助
./deploy-k3s.sh help

# 查看 Helm chart 信息
helm show values ./helm/mailman

# 测试部署配置
helm template mailman ./helm/mailman \
  --values ./helm/mailman/values-k3s.yaml
```

## 📝 配置文件说明

| 文件 | 用途 | 特点 |
|------|------|------|
| `values-matrixdb-production.yaml` | 生产配置 | 完整功能，资源充足 |
| `values-k3s.yaml` | K3s 优化 | 资源优化，适合边缘 |
| `values-local-test.yaml` | 本地测试 | 最小配置 |
| `deploy-k3s.sh` | 部署脚本 | 一键部署 |

## 🌟 快速参考

```bash
# 部署
./deploy-k3s.sh

# 状态
./deploy-k3s.sh status

# 卸载
./deploy-k3s.sh cleanup

# 日志
kubectl logs -f deployment/mailman-backend
kubectl logs -f deployment/mailman-frontend

# 重启
kubectl rollout restart deployment/mailman-backend
kubectl rollout restart deployment/mailman-frontend

# 更新
helm upgrade mailman ./helm/mailman --reuse-values

# 回滚
helm rollback mailman
```

---

**提示**: K3s 非常适合边缘计算、IoT 设备、CI/CD 环境和本地开发。如遇问题，请查看 [`K3S_DEPLOYMENT.md`](K3S_DEPLOYMENT.md) 获取详细排查指南。