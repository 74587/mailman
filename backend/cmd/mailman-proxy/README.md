# Mailman 本地回调代理

`mailman-proxy` 是一个轻量级本地透明转发网关，用于把本机收到的 Mailman 回调请求转发到指定服务。

例如本地监听 `8080` 端口时：

```bash
http://localhost:8080/api/oauth2/callback/gmail
```

会被转发到：

```bash
https://mailman.easycat.io/api/oauth2/callback/gmail
```

## 构建

在 `backend` 目录下运行：

```bash
go build -o build/mailman-proxy ./cmd/mailman-proxy
```

或使用 Makefile：

```bash
make build-mailman-proxy
```

## 使用

```bash
./build/mailman-proxy -listen-ip=127.0.0.1 -port=8080 -target=https://mailman.easycat.io
```

短参数写法：

```bash
./build/mailman-proxy -i=127.0.0.1 -p=8080 -t=https://mailman.easycat.io
```

所有参数都有默认值，等价于本地监听 `127.0.0.1:8080` 并转发到 `https://mailman.easycat.io`：

```bash
./build/mailman-proxy
```

目标也可以只写域名，默认使用 HTTPS：

```bash
./build/mailman-proxy -t=mailman.easycat.io
```

后台运行：

```bash
./build/mailman-proxy -p=8080 -t=https://mailman.easycat.io -b
```

关闭请求日志：

```bash
./build/mailman-proxy -l=false
```

使用 Makefile 启动：

```bash
make run-mailman-proxy
```

在仓库根目录也可以运行：

```bash
make proxy
```

覆盖默认值：

```bash
make run-mailman-proxy PROXY_PORT=18080 PROXY_TARGET=https://mailman.easycat.io
```

## 参数

- `-listen-ip`, `-i`: 监听 IP，默认 `127.0.0.1`
- `-port`, `-p`: 监听端口，默认 `8080`
- `-target`, `-t`: 转发目标域名或 URL，默认 `https://mailman.easycat.io`
- `-log`, `-l`: 是否输出请求日志，默认 `true`
- `-verbose`, `-v`: 是否输出更详细的转发日志，默认 `false`
- `-timeout`, `-T`: 目标服务响应头超时时间，默认 `60s`
- `-background`, `-b`: 后台运行
- `-daemon`, `-d`: 后台运行，等同于 `-background`
- `-log-file`, `-o`: 日志文件路径；后台运行时默认 `mailman-proxy.log`

## 环境变量

也可以通过环境变量设置默认值：

- `MAILMAN_PROXY_LISTEN_IP`
- `MAILMAN_PROXY_PORT`
- `MAILMAN_PROXY_TARGET`
- `MAILMAN_PROXY_LOG`
- `MAILMAN_PROXY_VERBOSE`
- `MAILMAN_PROXY_TIMEOUT`
- `MAILMAN_PROXY_LOG_FILE`
