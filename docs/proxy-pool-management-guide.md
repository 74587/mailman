# 代理池管理模块接入手册

本文档面向需要把 Mailman 用作代理资产管理平台和 HTTP / SOCKS5 代理入口的用户。读完后，你应该能够完成下面这条完整链路：

1. 录入上游代理，按分组和标签整理代理资产。
2. 创建代理网关，让 Mailman 对外提供 HTTP、SOCKS5 或 Mixed 混合代理端口。
3. 为网关配置安全策略、DNS 策略、出口策略和基于域名/IP 的目标路由。
4. 创建网关用户，授权可用网关，并选择遵循网关配置或使用兼容的用户独立代理策略。
5. 用 curl、浏览器、AdsPower、Playwright 或业务程序接入代理。
6. 通过运行状态、访问日志和审计日志排查问题。

## 1. 核心概念

代理池管理模块分为两层资源：

| 层级 | 资源 | 作用 |
| --- | --- | --- |
| 顶级资源 | 代理列表 | 保存上游代理。Mailman 访问目标网站时会从这里选择实际出口代理。 |
| 顶级资源 | 代理网关 | Mailman 自己监听的 HTTP / SOCKS5 / Mixed 代理入口。 |
| 顶级资源 | 网关用户 | 外部客户端连接 Mailman 代理入口时使用的用户名和密码，并决定出口遵循网关还是兼容的用户独立策略。 |
| 网关级资源 | 出口策略 | 定义代理池、调度、粘性和 fallback，可由目标路由或用户名后缀选择。 |
| 网关级资源 | 目标路由 | 按顺序匹配目标域名、IP 或 CIDR，第一条命中后选择对应出口策略。 |
| 网关级资源 | 安全策略 | 只属于某个网关。控制来源 IP、目标 Host、目标端口和内网阻断。 |
| 网关级资源 | DNS 策略 | 只属于某个网关。控制远端解析、本地解析、自定义 resolver 和 DNS 安全检查。 |
| 网关用户资源 | 账号分组 / 账号标签 | 单独维护，再在创建网关用户时选择。 |

实际访问链路如下：

```text
客户端
  -> Mailman 代理网关监听端口
  -> 网关用户认证
  -> 安全策略和 DNS 策略检查
  -> 先按目标路由匹配出口策略，未命中后按用户的代理策略来源选择网关默认出口或账号独立策略
  -> 上游代理访问目标网站
```

## 2. 菜单入口

进入 Mailman 后，左侧菜单中会看到独立的“代理池管理”菜单组。

| 菜单 | 用途 |
| --- | --- |
| 代理列表 | 管理上游代理、代理分组、代理标签、批量导入、批量检测。 |
| 代理网关 | 创建监听端口，进入网关详情后维护概览、目标路由、出口策略、安全策略、DNS 策略和网关日志。 |
| 网关用户 | 创建可以登录代理网关的账号，配置授权网关、代理策略来源和使用限制。 |
| 账号分组 | 单独维护网关用户分组。 |
| 账号标签 | 单独维护网关用户标签。 |
| 网关日志 | 查看访问日志和配置审计。 |

## 3. 准备工作

在开始之前，先确认：

1. Mailman 后端已经启动，Web 页面可以正常登录。
2. 如果要让外部机器连接 Mailman 代理网关，部署环境允许暴露对应端口。
3. 你已经准备好一批可用上游代理，例如：

```text
socks5://user:pass@us-1.example.net:1080
socks5://user:pass@us-2.example.net:1080
http://user:pass@sg-1.example.net:8080
http://jp-1.example.net:8080
```

> 生产环境建议先只监听 `127.0.0.1` 或内网地址。确实需要公网暴露时，必须开启代理账号认证，并配合来源 CIDR allowlist、防火墙或反向代理访问控制。

## 4. 第一步：维护上游代理

### 4.1 创建代理分组

进入“代理池管理 → 代理列表”，点击分组/标签维护入口，先创建分组。分组用于表达代理的主分类，通常一个代理只属于一个分组。

常见分组示例：

| 分组名 | 适用场景 |
| --- | --- |
| US Residential | 美国住宅代理，用于登录、注册、低风控业务。 |
| SG Datacenter | 新加坡机房代理，用于普通 API 请求。 |
| JP Mobile | 日本移动代理，用于移动端风控场景。 |
| Backup Pool | 备用代理池，只在主池失败时使用。 |

### 4.2 创建代理标签

标签用于表达多个维度，一个代理可以拥有多个标签。

常见标签示例：

| 标签名 | 用途 |
| --- | --- |
| login | 登录、注册、验证码场景。 |
| scraping | 采集、低风险请求。 |
| high-quality | 高质量代理。 |
| shared | 多账号共享。 |
| dedicated | 专用代理。 |
| warmup | 预热阶段使用。 |

### 4.3 单个新增代理

在“代理列表”点击新增，填写：

| 字段 | 说明 |
| --- | --- |
| 类型 | 支持 `http`、`https`、`socks5`、`ssh`。常见代理使用 `http` 或 `socks5`。 |
| Host | 代理服务器域名或 IP，不需要写协议。 |
| Port | 代理端口。 |
| Username / Password | 上游代理认证信息，没有认证可留空。 |
| 分组 | 从已维护分组中选择。 |
| 标签 | 从已维护标签中多选。 |
| 用途范围 | 可用于描述 shared、dedicated、login 等业务范围。 |
| 备注 | 写清来源、购买批次、过期时间或用途。 |

保存后建议立即点击“测试”。测试成功后，代理状态会变为可用，并记录延迟、出口 IP、国家、地区、城市、ISP 等信息。

### 4.4 批量导入代理

点击“批量导入”，选择默认类型、分组、标签和重复处理方式。

支持常见格式：

```text
host:port
host:port:username:password
username:password@host:port
socks5://username:password@host:port
http://username:password@host:port
```

重复处理方式建议：

| 策略 | 说明 |
| --- | --- |
| 跳过 | 生产推荐。已有代理不覆盖，避免误改。 |
| 更新 | 用新数据更新已有代理，适合批量刷新密码或备注。 |
| 允许 | 允许重复记录，一般不建议。 |

批量导入时可以勾选“导入后检测”。代理数量较大时，建议先小批量验证解析格式，再按分组分批导入。

### 4.5 代理列表维护建议

- 新代理导入后先检测，再分配给网关用户或策略。
- 定期批量检测，把失败代理标记出来。
- 删除代理前注意它可能被邮箱账户、网关用户、路由策略或 fallback 池引用。
- 对质量要求高的场景，使用分组加标签双重筛选，例如“US Residential + login + high-quality”。

### 4.6 代理流量统计

代理列表记录每个上游代理经“代理网关”转发的累计流入和流出流量。列表操作栏会汇总当前完整筛选结果中的所有代理，不受分页影响；表格和代理详情则显示单个代理的累计值。

- 流入：客户端经 Mailman 网关发往目标的数据。
- 流出：目标经上游代理返回客户端的数据。
- 计数在网关会话结束时持久化，刷新代理列表后可见。
- 代理检测请求，以及邮箱模块独立建立的代理连接，不计入这组网关流量。

## 5. 第二步：创建代理网关

代理网关是 Mailman 对客户端暴露的代理入口。客户端看到的是 Mailman 的 IP 和端口，Mailman 再从代理池中选择上游代理访问目标网站。

进入“代理池管理 → 代理网关”，点击新增网关。

### 5.1 基础字段

| 字段 | 建议值 | 说明 |
| --- | --- | --- |
| 网关名称 | `Mixed Proxy Gateway` | 便于用户识别。 |
| 监听 IP | `127.0.0.1` / `0.0.0.0` / 内网 IP | `127.0.0.1` 仅本机可用；`0.0.0.0` 会监听所有网卡。 |
| 外部访问地址 | `proxy.example.com` 或 `203.0.113.10` | 不做校验，只用于生成示例 curl。公网使用时应填真实域名或 IP。 |
| 外部访问端口 | `32027` 或留空 | Docker、Kubernetes、负载均衡把外部端口映射到监听端口时填写；留空则使用监听端口。 |
| 监听端口 | `32109` | Mailman 进程实际监听的端口，避免使用系统保留端口。 |
| 协议 | `mixed` | `mixed` 同端口支持 HTTP 和 SOCKS5。 |
| 启用 | 开启 | 启用后热加载才会启动监听。 |
| 设为默认网关 | 按需 | 创建网关用户时可默认选择。 |
| 允许公开监听 | 谨慎开启 | 非本机监听必须显式确认。 |
| 需要认证 | 强烈建议开启 | 公网监听不允许关闭认证。 |
| 默认安全策略 | 选择一个网关级安全策略 | 决定访问安全边界。 |
| 默认 DNS 策略 | 选择一个网关级 DNS 策略 | 决定解析方式和 DNS 安全行为。 |

### 5.2 协议选择

| 协议 | 客户端使用方式 | 适用场景 |
| --- | --- | --- |
| HTTP | `curl -x http://host:port --proxy-user user:pass https://example.com` | 浏览器 HTTP 代理、curl、普通 HTTP CONNECT。 |
| SOCKS5 | `curl --socks5-hostname host:port --proxy-user user:pass https://example.com` | 浏览器、爬虫、Playwright、支持 SOCKS5 的自动化工具。 |
| Mixed | 同一端口同时支持 HTTP 和 SOCKS5 | 推荐。减少端口数量，客户端按协议自动接入。 |

### 5.3 热加载

保存网关后，进入网关概览页点击“热加载”。

热加载行为：

- 新增或启用监听：开始绑定端口。
- 修改监听 IP、端口、协议、安全策略、DNS 策略：重建对应监听。
- 停用或删除监听：关闭对应端口。
- 修改账号、路由、安全、DNS 策略：新连接读取最新配置；已建立长连接不会强制中断。

## 6. 第三步：配置安全策略

安全策略属于具体网关。进入“代理网关 → 选择网关 → 配置策略 → 安全策略”维护。

### 6.1 推荐默认安全策略

生产环境推荐保留以下阻断项：

| 项 | 建议 | 说明 |
| --- | --- | --- |
| 阻断内网 IP | 开启 | 防止访问 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16` 等内网。 |
| 阻断回环 IP | 开启 | 防止访问 `127.0.0.1`、`::1`。 |
| 阻断链路本地 | 开启 | 防止访问 `169.254.0.0/16` 等链路本地地址。 |
| 阻断多播 | 开启 | 避免异常网络访问。 |
| 阻断 metadata IP | 开启 | 防止云主机 metadata SSRF，例如 `169.254.169.254`。 |
| DNS rebinding 防护 | 开启 | 域名解析到内网、回环、metadata 时会被拒绝。 |
| 未匹配动作 | `deny` | 没有命中允许规则时拒绝，更安全。 |

### 6.2 来源 CIDR

来源 CIDR 控制谁可以连接 Mailman 代理网关。

示例：

| 场景 | 来源允许 CIDR |
| --- | --- |
| 只允许本机 | `127.0.0.1/32` |
| 只允许内网办公段 | `10.10.0.0/16` |
| 只允许某台服务器 | `203.0.113.20/32` |
| 暂不限制 | 留空，但公网不推荐 |

如果同时配置 deny 和 allow，deny 优先。也就是说，命中拒绝列表会直接拒绝。

### 6.3 目标 Host allowlist / denylist

目标 Host 用来限制客户端可以访问哪些域名。

示例：

```text
# 只允许访问指定域名
example.com
*.example.com

# 拒绝敏感域名
localhost
*.internal
metadata.google.internal
```

匹配规则：

- `example.com` 只匹配该域名。
- `*.example.com` 匹配子域名，例如 `api.example.com`。
- `*` 匹配全部。

### 6.4 目标端口 allowlist / denylist

常见配置：

| 场景 | 端口规则 |
| --- | --- |
| 只允许 Web | `80`、`443` |
| 允许 Web 和邮件 | `80`、`443`、`993`、`995`、`587` |
| 拒绝数据库 | deny `3306`、`5432`、`6379` |
| 拒绝内网管理端口 | deny `22`、`2375`、`6443` |

端口支持单个值和范围：

```text
80
443
8000-8999
```

## 7. 第四步：配置 DNS 策略

DNS 策略属于具体网关。进入“代理网关 → 选择网关 → 配置策略 → DNS 策略”维护。

### 7.1 DNS 模式

| 模式 | 行为 | 适用场景 |
| --- | --- | --- |
| 远端解析 | Mailman 把域名交给上游代理解析。 | 最常见，减少本地 DNS 泄露，适合代理访问外网。 |
| 本地解析 | Mailman 本地解析目标域名，再把 IP 发给上游代理。 | 需要固定解析结果或做本地 DNS 控制。 |
| 自定义 resolver | Mailman 使用指定 DNS resolver 解析。 | 需要使用企业 DNS、DoH 网关前置解析器或特定地区 resolver。 |

### 7.2 关键开关

| 字段 | 建议 | 说明 |
| --- | --- | --- |
| SOCKS5 远端解析 | 开启 | SOCKS5 连接时把域名交给上游 SOCKS5 代理解析。关闭后 Mailman 会先本地解析。 |
| HTTP CONNECT 保留 Host | 开启 | 本地解析成 IP 后，CONNECT 的 Host 头仍保留原始域名，便于上游代理识别。 |
| 安全预解析 | 开启 | 远端解析模式下也先解析目标域名，用于安全策略检查。 |
| 缓存 TTL | 300 | 正常解析缓存时间。 |
| 失败 TTL | 60 | 解析失败缓存时间。 |
| 解析失败动作 | deny | 生产建议拒绝。只有明确接受风险时才使用 remote fallback。 |

### 7.3 多 IP 策略

| 策略 | 行为 |
| --- | --- |
| 全部检查 | 所有解析到的 IP 都必须通过安全检查。生产推荐。 |
| 只检查第一个 | 只检查第一个 IP。风险较高。 |
| 任意私网即拒绝 | 任意一个 IP 命中私网、回环、metadata 等阻断项即拒绝。 |

如果开启 DNS rebinding 防护，解析失败或解析结果为空都会按失败处理，不会静默放行。

## 8. 第五步：配置出口策略和用户名路由

出口策略属于具体网关，集中定义代理选择范围、调度算法、粘性、fallback、安全策略和 DNS 策略。它既可以被目标路由自动选择，也可以让同一个网关用户通过用户名后缀手动调用。

进入“代理网关 → 选择网关 → 配置策略 → 出口策略”，点击新增。

### 8.1 基础信息

| 字段 | 说明 |
| --- | --- |
| 策略名称 | 例如 `US Login Route`。 |
| 标志号 | 兼容模式显式选择出口策略时使用，例如 `?route=17`。池内索引模式的 `#17` 不使用它。 |
| 启用策略 | 关闭后该标志号不可用。 |
| 描述 | 写清用途，例如“美国登录专用，US Residential + login”。 |
| 索引越界 | 池内索引超过池大小时拒绝，或按 `((N-1) % 池大小) + 1` 取模循环。 |

### 8.2 池内代理索引（推荐）

新建网关用户默认使用“池内代理索引”。目标路由先根据目标域名或 IP 选择出口策略和代理池，然后用户名后缀选择该池的第 N 个代理：

```text
proxy_user#1
proxy_user#2
proxy_user?index=2
proxy_user?proxy=2
proxy_user?pi=2
```

索引从 1 开始。显式临时代理池按保存的代理 ID 顺序编号；全部可用或按组/标签筛选的池按代理 ID 升序编号。未带后缀时，仍使用出口策略原有的随机、轮询、权重或其他调度算法。

目标路由选择的出口策略决定索引越界方式。例如池内有 10 个代理且策略开启“取模循环”时：

```text
#10 -> 第 10 个
#20 -> 第 10 个
#21 -> 第 1 个
```

如果使用账号自己的代理池，则由账号的“索引越界”配置决定；如果目标路由选择了出口策略，则由最终出口策略的配置决定。

### 8.3 策略编号（存量兼容）

已有网关用户默认保留“策略编号”模式，原来的用户名无需修改：

```text
proxy_user#17
proxy_user?route=17
proxy_user?router=17
proxy_user?rs=17
proxy_user?strategy=17
```

此模式下 `#17` 仍表示出口策略的标志号，并要求账号获得该策略授权。`route`、`router`、`rs`、`strategy` 始终显式表示策略编号；`index`、`proxy`、`pi` 始终显式表示池内索引。

`#` 是默认兼容分隔符。网关编辑页可以为智能用户名逐行配置多个符号分隔符，例如 `#`、`~`、`--`；解析时优先匹配较长的分隔符。分隔符不能包含 ASCII 冒号，因为 HTTP Basic 用户名不能包含冒号。查询参数别名不受分隔符配置影响。

`#` 格式支持附加参数，参数会进入访问日志：

```text
proxy_user#17;purpose=signup;batch=202606
```

### 8.4 权限控制

两种模式都要求：

1. 网关用户启用智能用户名后缀。
2. 网关用户被授权使用当前网关。
3. 池内索引是正整数，最终代理池非空，且索引满足出口策略的越界规则。
4. 兼容模式下，网关用户还必须被授权使用该路由策略，或开启“允许全部路由策略”。

未授权会在认证阶段被拒绝。

开启智能用户名路由的用户会在列表中出现批量导出按钮。导出弹窗只展示该用户已授权、已启用且需要认证的网关；生成数量等于最终配置条数，HTTP / SOCKS5 协议为单选。池内索引模式可顺序生成 `1..N`，也可生成 N 个不重复随机正整数；随机数建议配合“取模循环”。兼容模式仍从已授权策略编号中生成。导出格式支持标准代理 URL、`用户:密码@地址:端口`、`地址:端口:用户:密码`、`地址:端口@用户:密码`、`用户:密码:地址:端口`、CSV、TSV 和 JSON Lines，并支持一键复制。标准 URL 会编码凭据，IPv6 地址会自动加方括号。

目标路由由管理员配置并强制执行。池内索引模式下，目标路由和后缀不会冲突：目标路由负责选池，后缀只负责选池内代理。兼容策略编号仍受目标路由优先级约束。

## 9. 第六步：配置目标路由

目标路由根据客户端请求中的目标域名或 IP，自动选择一个出口策略。进入“代理网关 → 选择网关 → 配置策略 → 目标路由”维护。

### 9.1 路由模型

每个网关可以配置多条有序规则和一个默认出口：

```text
顺序 10  api.example.com       -> IPv4 API 出口
顺序 20  *.legacy.example.com  -> Legacy 出口
顺序 30  203.0.113.0/24        -> 固定 IP 出口
默认     未命中                -> IPv6 默认出口
```

非默认规则必须至少填写一个匹配项并引用一个启用的出口策略。默认规则没有匹配项，只在所有普通规则都未命中时使用；同一网关只保留一个默认规则。

未配置默认规则时的行为由网关用户的“代理策略来源”决定：选择“独立代理策略”的存量用户继续使用账号自己的代理池，以保持现有应用行为；选择“遵循网关配置”的用户必须显式调用已授权的用户名路由策略，否则连接会返回网关缺少默认出口的配置错误，不会静默使用账号中保留的旧配置。

### 9.2 支持的匹配项

| 写法 | 行为 |
| --- | --- |
| `example.com` | 只匹配该域名。 |
| `*.example.com` | 匹配子域名，不包含根域名 `example.com`。 |
| `203.0.113.7` | 精确匹配一个 IPv4 地址。 |
| `203.0.113.0/24` | 匹配 IPv4 CIDR。 |
| `2001:db8::7` | 精确匹配一个 IPv6 地址。 |
| `2001:db8::/32` | 匹配 IPv6 CIDR。 |

域名匹配忽略大小写和末尾的点，并支持国际化域名标准化。不要创建 `*` 规则；需要兜底时使用“设为默认出口”。

### 9.3 第一条匹配即生效

普通规则按“匹配顺序”从小到大执行，相同顺序按创建顺序稳定排序。第一条匹配规则确定出口后，不再尝试后面的规则。

如果该出口连接失败，不会继续匹配下一条普通规则，也不会隐式回到默认出口。默认行为只执行出口策略自身的重试、备用池或直连 Fallback；如需切换到另一个完整代理池，可在当前目标路由中显式开启“失败切换”。

目标路由属于网关管理员强制策略。池内索引模式下，它先确定出口代理池，随后才应用 `#N`；兼容策略编号模式下，它仍优先于客户端请求的出口策略，避免客户端绕过指定域名或 IP 的出口要求。

### 9.4 路由级失败切换与熔断缓存

目标路由可以绑定一个与主出口不同的“兜底出口策略”。执行顺序固定为：

```text
主出口代理池及内部重试/备用池
  -> 兜底出口代理池及内部重试/备用池
  -> 显式允许的直连（最后手段）
```

它不是下一条目标路由，也不会重新做域名匹配。这样可以让默认 IPv6 出口失败时切换到 IPv4 出口，同时避免多级路由链和循环引用。

只有“主出口失败且兜底出口成功”才会累计主出口失败。达到窗口内失败阈值后，系统按网关、目标路由、主出口策略、目标 Host + 端口缓存熔断状态；智能用户名带池内索引时，索引也属于缓存范围，单个索引代理故障不会污染同一池的其他索引。熔断期间直接使用兜底出口，到期后只放行配置数量的半开探测连接。

半开探测再次出现“主失败、兜底成功”时使用指数退避；退避受“最大退避”硬限制。例如初始 60 秒、倍数 2、最大 300 秒时，退避约为 `60 -> 120 -> 240 -> 300 -> 300 ...`，并可增加抖动避免并发探测。主出口成功会立即清空该目标的熔断状态；两个出口同时失败不会提高退避级别。保存目标路由或相关出口策略会清除该网关的旧熔断缓存，避免新配置继承旧判断。

池内索引会原样传给兜底出口。例如请求携带 `#20`，主出口和兜底出口都各自使用 `20`，再分别按自己的池大小执行“越界拒绝”或“取模循环”。

访问日志会记录主出口、兜底出口、失败原因、是否实际切换、熔断状态、缓存命中和半开探测。

### 9.5 SOCKS5 域名与 IP

- 客户端使用远端解析，例如 `--socks5-hostname` 或 `socks5h://` 时，Mailman 收到域名并匹配域名规则。
- 客户端提前解析并只发送 IP 时，Mailman 匹配单 IP 或 CIDR 规则。
- Mailman 不会对客户端发送的 IP 做反向 DNS，因此 IP 目标不会命中域名规则。

访问日志会记录命中的目标路由 ID、具体匹配项，以及是否使用默认目标路由。保存、更新或删除目标路由后会立即刷新内存规则表，不需要重启监听。

## 10. 第七步：维护网关用户分组和标签

网关用户分组和标签独立维护，不在创建账号时临时创建。

推荐方式：

| 类型 | 示例 |
| --- | --- |
| 分组 | `运营团队 A`、`爬虫任务`、`外部合作方`、`本机测试` |
| 标签 | `低并发`、`高并发`、`只读`、`注册`、`登录`、`临时账号` |

创建网关用户时，只从已有分组和标签中选择。

## 11. 第八步：创建网关用户

进入“代理池管理 → 网关用户”，点击新增。

### 11.1 账号基础信息

| 字段 | 说明 |
| --- | --- |
| 用户名 | 连接代理时使用。支持一键生成。 |
| 密码 | 连接代理时使用。支持一键生成。 |
| 显示名称 | 给管理员看的名称。 |
| 备注 | 写清用途、负责人、过期时间。 |
| 账号分组 | 搜索下拉选择，默认“不分组”。 |
| 账号标签 | 搜索下拉多选。 |
| 启用状态 | 关闭后无法认证。 |
| 过期时间 | 到期后无法认证。 |

用户名和密码会通过后端接口做存在性、格式和强度检查。

### 11.2 网关授权

| 配置 | 行为 |
| --- | --- |
| 允许全部网关 | 用户可以连接所有启用网关。 |
| 可使用的网关 | 搜索选择具体网关，选择后以标签回显，可移除。 |

生产环境建议不要给普通用户“全部网关”，而是明确授权业务需要的网关。

### 11.3 代理策略来源

| 来源 | 行为 | 默认对象 |
| --- | --- | --- |
| 遵循网关配置 | 由目标路由、默认出口或显式用户名路由策略决定代理池；账号中保留的独立配置不参与选路。 | 新版界面创建的新用户。 |
| 独立代理策略 | 保持原有账号级代理池、调度、粘性和 fallback；网关目标路由仍然优先。 | 升级前已经存在的用户，以及未传新字段的旧 API 客户端。 |

在两种来源之间切换不会删除用户原有的代理池字段。切换到“遵循网关配置”后可以随时切回“独立代理策略”恢复使用。用户被授权多个网关时，“遵循网关配置”会按照本次实际连接的网关分别选路。

### 11.4 独立代理选择范围（兼容模式）

| 范围 | 行为 | 何时使用 |
| --- | --- | --- |
| 全部可用 | 从所有可用上游代理中选择。 | 小规模测试，或代理池已经全部同质化。 |
| 按组/标签 | 只从选定代理分组和标签中选择。 | 生产推荐。 |
| 临时代理池 | 只从手动选择的代理 ID 中选择。 | 专用池、临时任务、灰度验证。 |

当选择“按组/标签”时，需要选择代理分组和代理标签；当选择“临时代理池”时，通过“添加代理”打开代理列表子弹窗筛选并多选代理。

### 11.5 独立调度算法（兼容模式）

| 算法 | 行为 | 建议 |
| --- | --- | --- |
| 随机 | 每次随机选一个候选代理。 | 通用。 |
| 轮询 | 按候选代理顺序轮流使用。 | 均匀分摊请求。 |
| 权重随机 | 按代理权重选择。 | 代理质量差异明显时使用。 |
| 最低延迟 | 优先使用检测延迟最低的代理。 | 对速度敏感。 |
| 优先复用最近成功 | 优先复用上次成功代理。 | 稳定会话、降低失败率。 |

### 11.6 独立粘性策略（兼容模式）

粘性策略用于让一类请求在 TTL 内尽量复用同一个上游代理。

| 粘性模式 | 粘性 key | 适用场景 |
| --- | --- | --- |
| 不粘性 | 无 | 每次按算法重新选择。 |
| 按账号 | 网关用户 | 同一个网关用户保持稳定出口。 |
| 按客户端 IP | 客户端来源 IP | 同一机器保持稳定出口。 |
| 按目标域名 | 目标 Host | 访问同一目标域名保持稳定出口。 |
| 客户端 IP + 目标域名 | 来源 IP + 目标 Host | 兼顾多客户端和多目标。 |

TTL 建议：

| 场景 | TTL |
| --- | --- |
| 登录注册 | 600 到 1800 秒 |
| 浏览器会话 | 1800 到 7200 秒 |
| API 采集 | 60 到 300 秒 |

### 11.7 独立 Fallback 策略（兼容模式）

| 策略 | 行为 |
| --- | --- |
| 中断 | 上游代理失败后直接失败。最安全。 |
| 重试换代理 | 从主候选池排除失败代理后继续尝试。 |
| 备用池 | 主池失败后切到备用代理池。 |
| 允许直连 fallback | 代理池不可用时直连目标。生产慎用。 |

生产建议：

- 登录、注册、风控敏感业务：使用“中断”或“重试换代理”，不要直连。
- 普通数据请求：可使用“备用池”。
- 只有业务明确接受暴露服务器真实出口 IP 时，才开启直连 fallback。

### 11.8 限速、并发和会话控制

| 字段 | 说明 |
| --- | --- |
| 最大并发 | 同一网关用户可同时建立的连接数，0 表示不限制。 |
| 每分钟连接数 | 简单 rate limit，防止账号被过度使用。 |
| 带宽限制 KB/s | 控制单账号流量速度。 |
| 连接超时 | 连接目标或上游代理的超时时间。 |
| 空闲超时 | 无数据传输多久断开。 |
| 最大会话时长 | 单次连接最长持续时间，0 表示不限制。 |

推荐初始值：

| 场景 | 最大并发 | 每分钟连接数 | 空闲超时 | 最大会话 |
| --- | --- | --- | --- | --- |
| 本机测试 | 0 | 0 | 120s | 0 |
| 外部合作方 | 5 到 20 | 60 到 300 | 120s | 1800s |
| 自动化浏览器 | 10 到 50 | 300 到 1000 | 300s | 7200s |

## 12. 第九步：生成并使用代码示例

在网关用户列表中点击“代码示例”，选择一个该用户可用的网关。页面会实时拉取网关信息，不使用缓存，并允许单独复制代理 URL、curl 命令和程序接入片段。旁边的“文档”按钮会打开本接入手册。

页面生成的代理 URL 会把用户名和密码按 URL 规则编码，适合粘贴到需要完整代理地址的工具里。页面生成的 curl 使用 `--proxy-user '用户名:密码'` 传递原始凭据。这里不要把密码里的字符做 URL 编码，例如真实密码包含 `}` 时应写 `}`，不要写成 `%7d`。只有把凭据直接嵌入代理 URL 时，才需要按 URL 规则编码。

### 12.1 完整代理 URL

```text
http://gw_user:gw_password@proxy.example.com:32109
socks5://gw_user:gw_password@proxy.example.com:32109
```

如果用户名使用池内索引后缀，`#` 需要编码成 `%23`：

```text
http://gw_user%232:gw_password@proxy.example.com:32109
socks5://gw_user%232:gw_password@proxy.example.com:32109
```

### 12.2 HTTP 代理 curl

```bash
curl -x 'http://proxy.example.com:32109' \
  --proxy-user 'gw_user:gw_password' \
  'https://api.ipify.org?format=json'
```

如果用户名包含 `#`、`?` 等特殊字符，建议整体加引号：

```bash
curl -x 'http://proxy.example.com:32109' \
  --proxy-user 'gw_user#2:gw_password' \
  'https://api.ipify.org?format=json'
```

### 12.3 SOCKS5 代理 curl

```bash
curl --socks5 'proxy.example.com:32109' \
  --proxy-user 'gw_user:gw_password' \
  'https://api.ipify.org?format=json'
```

使用 SOCKS5 远端解析：

```bash
curl --socks5-hostname 'proxy.example.com:32109' \
  --proxy-user 'gw_user:gw_password' \
  'https://example.com'
```

使用用户名路由：

```bash
curl --socks5-hostname 'proxy.example.com:32109' \
  --proxy-user 'gw_user#2:gw_password' \
  'https://example.com'
```

### 12.4 Mixed 网关

Mixed 网关同一端口可同时支持 HTTP 和 SOCKS5。客户端选择哪种协议，Mailman 就按对应协议处理：

```bash
# HTTP CONNECT
curl -x 'http://proxy.example.com:32109' --proxy-user 'gw_user:gw_password' https://example.com

# SOCKS5
curl --socks5-hostname 'proxy.example.com:32109' --proxy-user 'gw_user:gw_password' https://example.com
```

### 12.5 浏览器接入

浏览器代理配置：

| 字段 | HTTP 代理 | SOCKS5 代理 |
| --- | --- | --- |
| Host | `proxy.example.com` | `proxy.example.com` |
| Port | `32109` | `32109` |
| Username | `gw_user` 或 `gw_user#2` | `gw_user` 或 `gw_user#2` |
| Password | 网关用户密码 | 网关用户密码 |

如果浏览器不支持用户名密码内置保存，可以使用浏览器插件或自动化工具传入认证信息。

### 12.6 Playwright 接入

```ts
import { chromium } from 'playwright'

const browser = await chromium.launch({
  proxy: {
    server: 'http://proxy.example.com:32109',
    username: 'gw_user#2',
    password: 'gw_password',
  },
})

const page = await browser.newPage()
await page.goto('https://api.ipify.org?format=json')
console.log(await page.textContent('body'))
await browser.close()
```

SOCKS5：

```ts
const browser = await chromium.launch({
  proxy: {
    server: 'socks5://proxy.example.com:32109',
    username: 'gw_user',
    password: 'gw_password',
  },
})
```

### 12.7 Python requests 接入

```python
import requests

proxies = {
    "http": "http://gw_user:gw_password@proxy.example.com:32109",
    "https": "http://gw_user:gw_password@proxy.example.com:32109",
}

print(requests.get("https://api.ipify.org?format=json", proxies=proxies, timeout=20).text)
```

如果用户名使用池内索引后缀，建议 URL 编码：

```python
from urllib.parse import quote

username = quote("gw_user#2", safe="")
password = quote("gw_password", safe="")
proxy = f"http://{username}:{password}@proxy.example.com:32109"
```

### 12.8 AdsPower / 指纹浏览器接入

一般填写：

| 字段 | 值 |
| --- | --- |
| Proxy type | HTTP、SOCKS5，或按网关协议选择。 |
| Host | 网关外部访问地址。 |
| Port | 网关端口。 |
| Username | 网关用户名，可带池内代理索引；兼容账号也可带策略编号。 |
| Password | 网关用户密码。 |

如果工具支持代理检测，检测目标建议使用 `https://api.ipify.org?format=json` 或你自己的出口检查服务。

## 13. 邮箱账户如何使用代理池

代理池不仅能给代理网关使用，也能给邮箱账户使用。

在邮箱账户编辑页的代理配置中，常见模式如下：

| 模式 | 行为 |
| --- | --- |
| 手动代理 | 直接填写一个代理 URL，例如 `socks5://user:pass@host:port`。 |
| 指定代理池条目 | 从代理列表中选一个固定代理。 |
| 自动匹配 | 按代理分组和标签自动选择可用代理。 |

Fallback：

| 模式 | 行为 |
| --- | --- |
| interrupt | 主代理失败后中断。 |
| manual_backup | 使用手动备用代理或备用代理池条目。 |
| auto_select | 自动从代理池中重新选择。 |

邮箱账户代理主要用于 IMAP、SMTP、OAuth2 相关访问；代理网关则用于对外提供通用 HTTP / SOCKS5 代理入口。两者共享同一个上游代理池，但使用场景不同。

## 14. API 快速参考

所有管理接口都走 Mailman 登录态，通常需要 Bearer Token。

### 14.1 代理池 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/proxy-pool` | 查询代理列表，并返回当前完整筛选结果的 `trafficSummary` 流量汇总。 |
| POST | `/api/proxy-pool` | 新增代理。 |
| PUT | `/api/proxy-pool/{id}` | 更新代理。 |
| DELETE | `/api/proxy-pool/{id}` | 删除代理。 |
| POST | `/api/proxy-pool/bulk-import` | 批量导入代理。 |
| POST | `/api/proxy-pool/{id}/test` | 测试单个代理。 |
| POST | `/api/proxy-pool/test-batch` | 批量测试代理。 |
| DELETE | `/api/proxy-pool/batch` | 批量删除代理。 |
| POST | `/api/proxy-pool/select` | 按条件选择可用代理。 |
| GET | `/api/proxy-pool/check-channels` | 获取检测通道。 |
| GET | `/api/proxy-groups` | 查询代理分组。 |
| POST | `/api/proxy-groups` | 创建代理分组。 |
| GET | `/api/proxy-tags` | 查询代理标签。 |
| POST | `/api/proxy-tags` | 创建代理标签。 |

### 14.2 代理网关 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/proxy-gateway/listeners` | 查询网关。 |
| POST | `/api/proxy-gateway/listeners` | 创建网关。 |
| PUT | `/api/proxy-gateway/listeners/{id}` | 更新网关。 |
| DELETE | `/api/proxy-gateway/listeners/{id}` | 删除网关。 |
| GET | `/api/proxy-gateway/accounts` | 查询网关用户。 |
| POST | `/api/proxy-gateway/accounts` | 创建网关用户。 |
| PUT | `/api/proxy-gateway/accounts/{id}` | 更新网关用户。 |
| GET | `/api/proxy-gateway/account-groups` | 查询网关用户分组。 |
| GET | `/api/proxy-gateway/account-tags` | 查询网关用户标签。 |
| GET | `/api/proxy-gateway/route-strategies` | 查询可复用出口策略。 |
| POST | `/api/proxy-gateway/route-strategies` | 创建可复用出口策略。 |
| GET | `/api/proxy-gateway/target-routes?gatewayId={id}` | 查询网关目标路由。 |
| POST | `/api/proxy-gateway/target-routes` | 创建域名/IP/CIDR 目标路由。 |
| PUT | `/api/proxy-gateway/target-routes/{id}` | 更新目标路由并立即刷新规则表。 |
| DELETE | `/api/proxy-gateway/target-routes/{id}` | 删除目标路由并立即刷新规则表。 |
| GET | `/api/proxy-gateway/security-policies` | 查询安全策略。 |
| POST | `/api/proxy-gateway/security-policies` | 创建安全策略。 |
| GET | `/api/proxy-gateway/dns-policies` | 查询 DNS 策略。 |
| POST | `/api/proxy-gateway/dns-policies` | 创建 DNS 策略。 |
| GET | `/api/proxy-gateway/logs` | 查询访问日志。 |
| GET | `/api/proxy-gateway/audit-logs` | 查询审计日志。 |
| GET | `/api/proxy-gateway/status` | 查询运行状态。 |
| POST | `/api/proxy-gateway/reload` | 热加载网关监听。 |

访问日志接口返回 `{items,total,page,limit}`，支持 `page`、`limit`、`listenerId`、`startTime`、`endTime`、`sourceIp`、`status`、`accountId`、`accountName`、`target` 和 `targetMatch` 查询参数。时间使用 RFC3339；`targetMatch` 可取 `wildcard`（`*`、`?`）或 `regex`。

网关用户请求中的 `proxySelectionSource` 可取 `gateway` 或 `account`。为兼容旧客户端，创建时省略该字段会按 `account` 保存；更新时省略则保持数据库中的现有值。新版界面创建用户时会显式发送 `gateway`。

## 15. 0 到 1 示例

下面是一个推荐的生产前验证流程。

### 15.1 准备代理

1. 创建分组：`US Residential`。
2. 创建标签：`login`、`high-quality`。
3. 批量导入 5 到 10 个 SOCKS5 代理。
4. 批量检测，确认状态为可用。

### 15.2 创建 Mixed 网关

1. 名称：`Mixed Proxy Gateway`。
2. 监听 IP：本机测试填 `127.0.0.1`，生产填内网 IP 或 `0.0.0.0`。
3. 外部访问地址：生产域名或 IP，例如 `proxy.example.com`。
4. 端口：`32109`。
5. 协议：`mixed`。
6. 需要认证：开启。
7. 保存后进入概览点击“热加载”。

### 15.3 创建安全策略

1. 来源允许 CIDR：先填你的测试机 IP，例如 `203.0.113.20/32`。
2. 目标端口允许：`80`、`443`。
3. 阻断内网、回环、链路本地、多播、metadata：全部开启。
4. DNS rebinding 防护：开启。
5. 未匹配动作：`deny`。
6. 设为默认策略。

### 15.4 创建 DNS 策略

1. 模式：远端解析。
2. SOCKS5 远端解析：开启。
3. HTTP CONNECT 保留 Host：开启。
4. 安全预解析：开启。
5. 多 IP 策略：全部检查。
6. 解析失败动作：拒绝。
7. 设为默认策略。

### 15.5 创建默认出口

1. 在网关“出口策略”中创建 `US Residential Default`。
2. 选择范围：按组/标签。
3. 代理分组：`US Residential`。
4. 代理标签：`login`、`high-quality`。
5. 调度算法：轮询或随机。
6. 粘性策略：按账号，TTL 1800 秒。
7. Fallback：重试换代理，最大重试 2。
8. 在“目标路由”中新增规则，引用该出口策略并开启“设为默认出口”。

### 15.6 创建网关用户

1. 用户名：一键生成或填写 `gw_login_us`。
2. 密码：一键生成。
3. 可使用网关：选择 `Mixed Proxy Gateway`。
4. 代理策略来源：遵循网关配置。
5. 最大并发：10。
6. 每分钟连接数：120。
7. 保存。

### 15.7 生成代码示例

在网关用户列表中点击“代码示例”，选择 `Mixed Proxy Gateway`。

完整代理 URL：

```text
http://gw_login_us:password@proxy.example.com:32109
socks5://gw_login_us:password@proxy.example.com:32109
```

HTTP 测试：

```bash
curl -x 'http://proxy.example.com:32109' \
  --proxy-user 'gw_login_us:password' \
  'https://api.ipify.org?format=json'
```

SOCKS5 测试：

```bash
curl --socks5-hostname 'proxy.example.com:32109' \
  --proxy-user 'gw_login_us:password' \
  'https://api.ipify.org?format=json'
```

成功后，进入“网关日志”确认：

- 账号是 `gw_login_us`。
- 协议是 `http` 或 `socks5`。
- 状态是 `success`。
- 上游代理 ID 命中预期分组和标签。
- DNS 模式和安全策略 ID 正确。

## 16. 常见故障排查

### 16.1 连接代理网关失败

检查：

1. 网关是否启用。
2. 是否点击热加载。
3. 运行状态里是否显示 running。
4. 端口是否被占用。
5. 监听 IP 是否正确。
6. 防火墙或云安全组是否放行端口。

### 16.2 认证失败

检查：

1. 用户名和密码是否正确。
2. 网关用户是否启用或已过期。
3. 用户是否被授权使用该网关。
4. 如果用户名带 `#N`，是否开启智能用户名后缀，账号模式与预期是否一致，索引是否越界。
5. 路由策略是否存在、启用，并授权给该用户。

### 16.3 没有可用代理

检查：

1. 代理列表中是否存在状态可用的代理。
2. 网关用户选择范围是否过窄。
3. 分组和标签是否选错。
4. 临时代理池是否为空。
5. 上游代理是否检测失败。

### 16.4 访问被安全策略拒绝

检查访问日志的错误信息：

| 错误类型 | 处理方式 |
| --- | --- |
| client IP is not in source allowlist | 把客户端公网 IP 加入来源允许 CIDR。 |
| target host is not allowed | 调整目标 Host allowlist。 |
| target port is not allowed | 调整目标端口 allowlist。 |
| target IP is private / loopback / metadata | 目标解析到了被阻断地址，确认是否为 SSRF 风险。 |

### 16.5 DNS 解析失败

检查：

1. DNS 策略模式是否正确。
2. 自定义 resolver 是否可达。
3. 解析失败动作是否为 deny。
4. 目标域名是否确实存在。
5. DNS rebinding 防护是否因解析到内网地址而拒绝。

### 16.6 curl HTTP 可以，SOCKS5 不行

检查：

1. 网关协议是否是 `mixed` 或 `socks5`。
2. curl 是否使用 `--socks5` 或 `--socks5-hostname`。
3. 客户端是否支持 SOCKS5 用户名密码认证。
4. DNS 策略中的 SOCKS5 远端解析是否符合预期。

### 16.7 SOCKS5 可以，HTTP CONNECT 不行

检查：

1. 网关协议是否是 `mixed` 或 `http`。
2. curl 是否使用 `-x http://...`。
3. 目标是否是 HTTPS 时，客户端是否发送 CONNECT。
4. 安全策略是否允许目标端口 443。

## 17. 安全基线清单

上线前逐项确认：

- 网关公网暴露时必须开启认证。
- 网关公网暴露时必须配置来源 CIDR 或外层防火墙。
- 默认安全策略开启内网、回环、链路本地、多播、metadata 阻断。
- 开启 DNS rebinding 防护。
- DNS 解析失败动作使用 deny。
- 目标端口至少限制到业务需要范围。
- 不给普通网关用户“允许全部网关”。
- 不给普通网关用户“允许全部路由策略”。
- 不默认开启直连 fallback。
- 给外部用户设置过期时间、最大并发、每分钟连接数和最大会话时长。
- 定期查看访问日志和审计日志。
- 定期轮换网关用户密码。

## 18. 源码和页面对应关系

| 范围 | 文件 |
| --- | --- |
| 代理池页面 | `frontend/src/components/tabs/proxy-pool-tab.tsx` |
| 代理网关页面 | `frontend/src/components/tabs/proxy-gateway-tab.tsx` |
| 代理池前端服务 | `frontend/src/services/proxy-pool.service.ts` |
| 代理网关前端服务 | `frontend/src/services/proxy-gateway.service.ts` |
| 代理池 API | `backend/internal/api/proxy_pool_handlers.go` |
| 代理网关 API | `backend/internal/api/proxy_gateway_handlers.go` |
| 代理池模型 | `backend/internal/models/proxy_pool.go` |
| 代理网关模型 | `backend/internal/models/proxy_gateway.go` |
| 代理网关运行时 | `backend/internal/services/proxy_gateway.go` |
