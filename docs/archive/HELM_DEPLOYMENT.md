# Mailman Kubernetes 部署指南

本文档介绍如何使用 Helm 在 Kubernetes 集群中部署 Mailman 邮箱管理系统。

**重要更新**：OAuth2 配置现在通过前端页面动态添加，无需在部署时预���配置 Gmail/Outlook 凭据。

## 📋 部署架构

```
Internet → Ingress → Frontend Service (Port 80)
                        ↓
                   Nginx Proxy
                        ↓
                   Backend Service (Port 8080, ClusterIP only)
                        ↓
                   MariaDB (Port 3306, ClusterIP only)
```

- **前端**: 对外暴露，接收所有外部请求，通过 Nginx 代理 API 请求到后端
- **后端**: 仅内部访问 (ClusterIP)，不直接对外暴露
- **数据库**: 完全不对外暴露，仅后端可访问

## 🚀 快速部署

### 1. 前置条件

- Kubernetes 1.24+
- Helm 3.8+
- kubectl 已正确配置集群访问权限

### 2. 部署数据库

```bash
# 部署 MariaDB (ARM 架构兼容)
kubectl apply -f ./helm/mailman/matrixdb-deployment.yaml
```

### 3. 部署应用

```bash
# 使用 Helm 部署 Mailman
helm install mailman ./helm/mailman \
  --namespace default \
  --values ./helm/mailman/values-matrixdb-production.yaml
```

### 4. 验证部署

OAuth2 配置现在通过前端页面动态添加，无需在部署时预先配置。

```bash
# 检查 Pod 状态
kubectl get pods -l app.kubernetes.io/name=mailman

# 检查服务
kubectl get services

# 测试前端 (使用 Service IP)
FRONTEND_IP=$(kubectl get svc mailman-frontend -o jsonpath='{.spec.clusterIP}')
curl http://$FRONTEND_IP

# 测试 API 代理
curl http://$FRONTEND_IP/api/health
```

## 📊 服务信息

| 服务名称 | 类型 | 端口 | 访问方式 | 说明 |
|----------|------|------|----------|------|
| mailman-frontend | ClusterIP | 80 | 通过 Ingress | 前端应用 |
| mailman-backend | ClusterIP | 8080 | 仅内部 | 后端 API |
| backend | ClusterIP | 8080 | 仅内部 | 后端服务别名 (供前端代理) |
| mariadb | ClusterIP | 3306 | 仅内部 | MariaDB 数据库 |

## 🔧 配置说明

### 镜像配置

当前使用 GitHub Container Registry 镜像：

- **前端**: `ghcr.io/seongminhwan/mailman-frontend:latest`
- **后端**: `ghcr.io/seongminhwan/mailman-backend:latest` (支持 CGO + MySQL)

如需使用其他镜像版本，可修改 `values-matrixdb-production.yaml`：

```yaml
mailman:
  backend:
    image:
      registry: ghcr.io
      repository: seongminhwan/mailman-backend
      tag: "v0.1.21"  # 指定版本
  frontend:
    image:
      registry: ghcr.io
      repository: seongminhwan/mailman-frontend
      tag: "v0.1.21"  # 指定版本
```

### 数据库配置

MariaDB 配置在 `matrixdb-deployment.yaml` 中：

- **用户**: mailman
- **密码**: mailman123 (生产环境请修改)
- **数据库**: mailman
- **端口**: 3306

### 资源配置

默认资源配置：

```yaml
backend:
  resources:
    limits:
      cpu: 1000m
      memory: 1Gi
    requests:
      cpu: 500m
      memory: 512Mi

frontend:
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 250m
      memory: 256Mi
```

## 🌐 生产环境配置

### Ingress 配置

```bash
# 创建 Ingress (示例)
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

### 安全配置

1. **修改数据库密码**：
   ```yaml
   # matrixdb-deployment.yaml
   env:
     - name: MYSQL_ROOT_PASSWORD
       value: "your-secure-password"
     - name: MYSQL_PASSWORD
       value: "your-secure-password"
   ```

2. **配置真实 OAuth2 凭据**：
   ```bash
   kubectl delete secret mailman-oauth2
   kubectl create secret generic mailman-oauth2 \
     --from-literal=gmail-client-id='your-real-client-id' \
     --from-literal=gmail-client-secret='your-real-client-secret' \
     --from-literal=outlook-client-id='your-real-client-id' \
     --from-literal=outlook-client-secret='your-real-client-secret'
   ```

3. **启用持久化存储**：确保 PVC 有足够的存储空间

4. **配置监控告警**：添加 Prometheus 和 Grafana

## 🔄 更新部署

```bash
# 更新应用配置
helm upgrade mailman ./helm/mailman \
  --values ./helm/mailman/values-matrixdb-production.yaml

# 重启特定服务
kubectl rollout restart deployment/mailman-backend
kubectl rollout restart deployment/mailman-frontend
```

## 🧹 清理部署

```bash
# 卸载 Helm release
helm uninstall mailman

# 删除数据库
kubectl delete -f ./helm/mailman/matrixdb-deployment.yaml

# 删除 PVC (可选，会删除数据)
kubectl delete pvc mariadb-pvc
```

## 🐛 故障排查

### 常见问题

1. **后端无法启动**：
   ```bash
   # 检查日志
   kubectl logs -l app.kubernetes.io/component=backend

   # 检查是否缺少 OAuth2 secret
   kubectl get secret mailman-oauth2
   ```

2. **前端代理失败**：
   ```bash
   # 检查 backend 服务是否存在
   kubectl get svc backend

   # 检查 Nginx 日志
   kubectl logs -l app.kubernetes.io/component=frontend
   ```

3. **数据库连接失败**：
   ```bash
   # 检查 MariaDB 状态
   kubectl logs -l app=mariadb

   # 测试数据库连接
   kubectl exec -it deployment/mailman-backend -- mysql -h mariadb -u mailman -p
   ```

### 有用的命令

```bash
# 查看所有资源
kubectl get all -l app.kubernetes.io/name=mailman

# 进入 Pod 调试
kubectl exec -it deployment/mailman-backend -- bash
kubectl exec -it deployment/mailman-frontend -- sh

# 端口转发调试
kubectl port-forward deployment/mailman-frontend 8080:80
kubectl port-forward deployment/mailman-backend 8081:8080
```

## 📝 版本信息

- **应用版本**: v0.1.21+
- **Helm Chart**: 0.1.0
- **Kubernetes**: 1.24+
- **支持的架构**: AMD64, ARM64

## 🤝 贡献

如需修改部署配置，请：

1. 修改 `helm/mailman/values-matrixdb-production.yaml`
2. 测试部署：`helm template mailman ./helm/mailman --values ./helm/mailman/values-matrixdb-production.yaml`
3. 提交 Pull Request