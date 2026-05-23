# Mailman K3s 集群部署指南

本文档专门介绍如何在 **K3s 轻量级 Kubernetes** 集群中部署 Mailman 邮箱管理系统。

## 📋 K3s 特性说明

K3s 是一个轻量级的 Kubernetes 发行版，具有以下特点：

- **内置 Traefik Ingress Controller** - 无需单独安装 Nginx Ingress
- **内置 Local Path Provisioner** - 自动提供本地存储
- **精简架构** - 二进制文件小于 100MB
- **快速启动** - 适合边缘计算和开发环境
- **完全兼容 K8s API**

## 🚀 快速部署

### 1. 前置条件

#### 安装 K3s

```bash
# 安装 K3s (默认配置)
curl -sfL https://get.k3s.io | sh -

# 检查 K3s 状态
sudo systemctl status k3s

# 配置 kubectl 访问权限
sudo chmod 644 /etc/rancher/k3s/k3s.yaml
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# 或者复制到用户目录
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
```

#### 验证安装

```bash
# 使用 k3s kubectl 或 kubectl
k3s kubectl get nodes
# 或
kubectl get nodes

# 检查默认组件
kubectl get pods -A
```

#### 安装 Helm

```bash
# 下载 Helm 安装脚本
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# 验证 Helm 安装
helm version
```

### 2. 部署 MariaDB 数据库

K3s 使用内置的 local-path 存储类，自动为 PVC 提供存储。

```bash
# 部署 MariaDB (使用 local-path-provisioner)
kubectl apply -f ./helm/mailman/matrixdb-deployment.yaml

# 等待 MariaDB 就绪
kubectl wait --for=condition=ready pod -l app=mariadb --timeout=300s

# 检查 PVC 状态
kubectl get pvc mariadb-pvc
```

### 3. 部署 Mailman 应用

```bash
# 使用 Helm 部署 Mailman
helm install mailman ./helm/mailman \
  --namespace default \
  --values ./helm/mailman/values-matrixdb-production.yaml

# 检查部署状态
kubectl get pods -l app.kubernetes.io/name=mailman

# 等待所有 Pod 就绪
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=mailman --timeout=300s
```

### 4. 配置 Traefik Ingress

K3s 默认使用 Traefik 作为 Ingress Controller，配置方式略有不同：

```bash
# 创建 Traefik Ingress
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mailman-ingress
  namespace: default
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
    # 如需 HTTPS，添加以下注解
    # traefik.ingress.kubernetes.io/router.entrypoints: websecure
    # traefik.ingress.kubernetes.io/router.tls: "true"
spec:
  rules:
  - host: mailman.local  # 修改为你的域名
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

#### 本地开发环境配置

如果是本地开发，可以使用 NodePort 直接访问：

```bash
# 修改前端服务为 NodePort
kubectl patch svc mailman-frontend -p '{"spec":{"type":"NodePort"}}'

# 获取访问端口
kubectl get svc mailman-frontend

# 访问应用
# http://localhost:<NodePort>
```

### 5. 配置 hosts 文件（本地开发）

```bash
# 获取 K3s 节点 IP
K3S_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')

# 添加到 hosts 文件
echo "$K3S_IP mailman.local" | sudo tee -a /etc/hosts
```

### 6. 验证部署

```bash
# 检查所有资源
kubectl get all -l app.kubernetes.io/name=mailman

# 检查 Ingress
kubectl get ingress

# 测试前端访问
curl -H "Host: mailman.local" http://localhost

# 或使用浏览器访问
# http://mailman.local
```

## 🔧 K3s 专属配置

### Storage Class 配置

K3s 默认提供 `local-path` StorageClass：

```bash
# 查看可用的 StorageClass
kubectl get storageclass

# 设置为默认 (如果未设置)
kubectl patch storageclass local-path -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

### Traefik Dashboard

K3s 的 Traefik 默认部署在 `kube-system` namespace：

```bash
# 查看 Traefik 服务
kubectl get svc -n kube-system traefik

# 端口转发访问 Dashboard
kubectl port-forward -n kube-system deployment/traefik 9000:9000

# 访问 http://localhost:9000/dashboard/
```

### LoadBalancer 支持

K3s 内置了 ServiceLB (Klipper-lb)，可以为 LoadBalancer 类型的服务分配 IP：

```bash
# 可选：将前端服务改为 LoadBalancer
kubectl patch svc mailman-frontend -p '{"spec":{"type":"LoadBalancer"}}'

# 获取分配的 IP
kubectl get svc mailman-frontend
```

## 📊 资源优化配置

K3s 适合资源受限环境，可以调整资源配置：

### 创建 values-k3s.yaml

```yaml
# values-k3s.yaml - K3s 优化配置
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

# 使用 K3s 默认 StorageClass
persistence:
  data:
    storageClassName: local-path
  logs:
    storageClassName: local-path
```

### 使用优化配置部署

```bash
helm install mailman ./helm/mailman \
  --values ./helm/mailman/values-matrixdb-production.yaml \
  --values ./helm/mailman/values-k3s.yaml
```

## 🌐 生产环境配置

### 使用 cert-manager 配置 HTTPS

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

# 更新 Ingress 启用 TLS
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

### 配置外部数据库（可选）

如果不想使用 MariaDB Pod，可以连接外部数据库：

```bash
# 修改 values 文件中的数据库配置
mailman:
  backend:
    env:
      DB_HOST: "your-external-db.example.com"
      DB_PORT: "3306"
      DB_USER: "mailman"
      DB_PASSWORD: "secure-password"
      DB_NAME: "mailman"
```

## 🔄 更新和维护

### 更新应用

```bash
# 拉取最新镜像
kubectl set image deployment/mailman-backend \
  backend=ghcr.io/seongminhwan/mailman-backend:latest

kubectl set image deployment/mailman-frontend \
  frontend=ghcr.io/seongminhwan/mailman-frontend:latest

# 或使用 Helm 升级
helm upgrade mailman ./helm/mailman \
  --values ./helm/mailman/values-matrixdb-production.yaml
```

### 备份数据库

```bash
# 导出数据库
kubectl exec -it deployment/mailman-backend -- \
  mysqldump -h mariadb -u mailman -pmailman123 mailman > mailman_backup.sql

# 或直接访问 MariaDB Pod
kubectl exec -it $(kubectl get pod -l app=mariadb -o jsonpath='{.items[0].metadata.name}') -- \
  mysqldump -u mailman -pmailman123 mailman > mailman_backup.sql
```

### 恢复数据库

```bash
# 导入数据库
kubectl exec -i $(kubectl get pod -l app=mariadb -o jsonpath='{.items[0].metadata.name}') -- \
  mysql -u mailman -pmailman123 mailman < mailman_backup.sql
```

## 🐛 K3s 特定故障排查

### 1. Pod 无法调度

```bash
# 检查节点状态
kubectl get nodes

# 检查节点资源
kubectl describe node

# K3s 单节点默认有污点，需要容忍
kubectl taint nodes --all node-role.kubernetes.io/master-
```

### 2. Traefik Ingress 不工作

```bash
# 检查 Traefik 状态
kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik

# 查看 Traefik 日志
kubectl logs -n kube-system -l app.kubernetes.io/name=traefik

# 检查 Ingress 是否被正确识别
kubectl describe ingress mailman-ingress
```

### 3. 存储问题

```bash
# 检查 local-path-provisioner
kubectl get pods -n kube-system -l app=local-path-provisioner

# 查看 PVC 绑定状态
kubectl get pvc

# 检查 PV
kubectl get pv

# 查看存储位置 (默认 /var/lib/rancher/k3s/storage)
sudo ls -la /var/lib/rancher/k3s/storage
```

### 4. 网络连接问题

```bash
# 检查 CNI 插件
kubectl get pods -n kube-system | grep -E 'coredns|traefik'

# 测试 DNS 解析
kubectl run -it --rm debug --image=busybox --restart=Never -- nslookup mailman-backend

# 测试服务连接
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://mailman-backend:8080/api/health
```

## 📝 有用的 K3s 命令

```bash
# 重启 K3s
sudo systemctl restart k3s

# 查看 K3s 日志
sudo journalctl -u k3s -f

# 卸载 K3s
/usr/local/bin/k3s-uninstall.sh

# 清理并重新安装
/usr/local/bin/k3s-uninstall.sh
curl -sfL https://get.k3s.io | sh -

# 导出 kubeconfig
sudo cat /etc/rancher/k3s/k3s.yaml

# K3s 配置文件位置
# /etc/rancher/k3s/k3s.yaml
# /var/lib/rancher/k3s/
```

## 🔐 安全建议

### 1. 修改默认密码

```bash
# 生成安全的数据库密码
DB_PASSWORD=$(openssl rand -base64 32)

# 更新 MariaDB Secret
kubectl create secret generic mariadb-secret \
  --from-literal=username=mailman \
  --from-literal=password=$DB_PASSWORD \
  --dry-run=client -o yaml | kubectl apply -f -

# 重启数据库和应用
kubectl rollout restart deployment/mailman-backend
kubectl delete pod -l app=mariadb
```

### 2. 限制网络访问

```bash
# 创建 NetworkPolicy
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: mailman-network-policy
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: mailman
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app.kubernetes.io/name: mailman
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: mariadb
  - to:
    - namespaceSelector: {}
      podSelector:
        matchLabels:
          k8s-app: kube-dns
EOF
```

## 📊 监控和日志

### 查看日志

```bash
# 查看后端日志
kubectl logs -f deployment/mailman-backend

# 查看前端日志
kubectl logs -f deployment/mailman-frontend

# 查看数据库日志
kubectl logs -f -l app=mariadb

# 查看最近的事件
kubectl get events --sort-by='.lastTimestamp'
```

### 安装 Prometheus 和 Grafana（可选）

```bash
# 使用 Helm 安装 kube-prometheus-stack
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace

# 访问 Grafana
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80
# 默认用户名: admin, 密码: prom-operator
```

## 🎯 性能调优

### K3s 配置优化

```bash
# 修改 K3s 配置 /etc/systemd/system/k3s.service
# 添加以下参数
--kubelet-arg="max-pods=200"
--kube-apiserver-arg="max-requests-inflight=400"
--kube-apiserver-arg="max-mutating-requests-inflight=200"

# 重启 K3s
sudo systemctl daemon-reload
sudo systemctl restart k3s
```

### 应用优化

```bash
# 启用 HPA (水平自动扩缩容)
kubectl autoscale deployment mailman-backend --cpu-percent=70 --min=1 --max=3
kubectl autoscale deployment mailman-frontend --cpu-percent=70 --min=1 --max=3

# 查看 HPA 状态
kubectl get hpa
```

## 🆘 获取帮助

如果遇到问题：

1. 查看 K3s 官方文档: https://docs.k3s.io
2. 查看项目 Issue: https://github.com/your-repo/issues
3. 查看 K3s 社区支持: https://github.com/k3s-io/k3s/discussions

## 📌 快速参考

```bash
# 一键部署脚本
#!/bin/bash
set -e

echo "部署 MariaDB..."
kubectl apply -f ./helm/mailman/matrixdb-deployment.yaml
kubectl wait --for=condition=ready pod -l app=mariadb --timeout=300s

echo "部署 Mailman..."
helm install mailman ./helm/mailman \
  --values ./helm/mailman/values-matrixdb-production.yaml

echo "等待 Pod 就绪..."
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=mailman --timeout=300s

echo "配置本地访问..."
kubectl patch svc mailman-frontend -p '{"spec":{"type":"NodePort"}}'

PORT=$(kubectl get svc mailman-frontend -o jsonpath='{.spec.ports[0].nodePort}')
echo "部署完成！访问地址: http://localhost:$PORT"
```

保存为 `deploy-k3s.sh` 并执行：

```bash
chmod +x deploy-k3s.sh
./deploy-k3s.sh
```

## 📝 版本信息

- **K3s**: v1.28+ (推荐)
- **Helm**: 3.8+
- **应用版本**: v0.1.21+
- **支持架构**: AMD64, ARM64

---

**提示**: K3s 非常适合边缘计算、IoT、CI/CD 和开发环境。对于大规模生产环境，建议使用标准 Kubernetes 集群。