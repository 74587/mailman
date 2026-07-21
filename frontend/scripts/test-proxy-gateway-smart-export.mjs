import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectDir = dirname(scriptDir)
const nextBin = join(projectDir, 'node_modules', '.bin', 'next')
const routePath = '/dev/proxy-gateway-smart-export-regression'
const artifactDir = process.env.PROXY_GATEWAY_QA_ARTIFACT_DIR || '/tmp/mailman-proxy-gateway-qa'

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Unable to allocate a test port')))
                return
            }
            server.close(() => resolve(address.port))
        })
    })
}

async function waitForServer(url, serverProcess) {
    const deadline = Date.now() + 60_000
    let lastError
    while (Date.now() < deadline) {
        if (serverProcess.exitCode !== null) {
            throw new Error(`Next dev server exited early with code ${serverProcess.exitCode}`)
        }
        try {
            const response = await fetch(url, { headers: { accept: 'text/html' } })
            if (response.status < 500) return
        } catch (error) {
            lastError = error
        }
        await delay(500)
    }
    throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'no response'}`)
}

function resolveChromeExecutable() {
    let bundledPath
    try {
        bundledPath = puppeteer.executablePath()
    } catch {
        bundledPath = undefined
    }
    return [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        bundledPath,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ].find(candidate => candidate && existsSync(candidate))
}

const listeners = [
    {
        id: 11,
        name: 'QA Mixed Gateway',
        listenIp: '::1',
        externalHost: '2001:db8::10',
        externalPort: 19080,
        port: 18080,
        protocol: 'mixed',
        enabled: true,
        isDefault: true,
        allowPublicListen: false,
        requireAuth: true,
        handshakeTimeoutSeconds: 10,
        idleTimeoutSeconds: 120,
        connectTimeoutSeconds: 30,
        usernameRouteSeparators: ['#', '--'],
    },
    {
        id: 12,
        name: 'QA Socks Gateway',
        listenIp: '127.0.0.1',
        externalHost: 'proxy.example.test',
        externalPort: 19081,
        port: 18081,
        protocol: 'socks5',
        enabled: true,
        isDefault: false,
        allowPublicListen: false,
        requireAuth: true,
        handshakeTimeoutSeconds: 10,
        idleTimeoutSeconds: 120,
        connectTimeoutSeconds: 30,
        usernameRouteSeparators: ['~'],
    },
]

const accounts = [
    {
        id: 21,
        username: 'route-user',
        password: 'secret-pass',
        name: '智能路由测试用户',
        enabled: true,
        allowAllGateways: false,
        allowedGatewayIds: [11, 12],
        proxySelectionSource: 'gateway',
        selectionMode: 'filtered',
        selectionAlgorithm: 'random',
        stickyMode: 'none',
        stickyTtlSeconds: 600,
        preferLastSuccess: false,
        fallbackMode: 'interrupt',
        maxRetries: 2,
        allowDirectFallback: false,
        maxConcurrent: 5,
        rateLimitPerMinute: 100,
        bandwidthLimitKbps: 0,
        connectTimeoutSeconds: 30,
        idleTimeoutSeconds: 120,
        maxSessionSeconds: 0,
        enableUsernameRouting: true,
        usernameRoutingMode: 'proxy_index',
        proxyIndexOverflowMode: 'modulo',
        allowAllRouteStrategies: false,
        allowedRouteStrategyIds: [102, 103, 106, 107],
    },
    {
        id: 22,
        username: 'plain-user',
        password: 'plain-pass',
        name: '普通用户',
        enabled: true,
        allowAllGateways: true,
        proxySelectionSource: 'gateway',
        selectionMode: 'all',
        selectionAlgorithm: 'random',
        stickyMode: 'none',
        stickyTtlSeconds: 600,
        preferLastSuccess: false,
        fallbackMode: 'interrupt',
        maxRetries: 2,
        allowDirectFallback: false,
        maxConcurrent: 0,
        rateLimitPerMinute: 0,
        bandwidthLimitKbps: 0,
        connectTimeoutSeconds: 30,
        idleTimeoutSeconds: 120,
        maxSessionSeconds: 0,
        enableUsernameRouting: false,
        allowAllRouteStrategies: false,
        allowedRouteStrategyIds: [],
    },
]

const routeStrategies = [
    { id: 101, gatewayId: 11, name: 'IPv6 默认池', flagNo: 1, enabled: true },
    { id: 102, gatewayId: 0, name: 'IPv4 服务池', flagNo: 4, enabled: true },
    { id: 103, gatewayId: 0, name: '重复编号全局池', flagNo: 1, enabled: true },
    { id: 104, gatewayId: 11, name: '未授权池', flagNo: 9, enabled: true },
    { id: 105, gatewayId: 11, name: '停用池', flagNo: 12, enabled: false },
    { id: 106, gatewayId: 11, name: '授权专属池', flagNo: 6, enabled: true },
    { id: 107, gatewayId: 12, name: 'SOCKS 专属池', flagNo: 7, enabled: true },
]

const targetRoutes = [
    {
        id: 301,
        gatewayId: 11,
        name: '缺失兜底策略测试',
        enabled: true,
        isDefault: true,
        sortOrder: 100,
        matchers: [],
        routeStrategyId: 101,
        routeStrategy: routeStrategies[0],
        failoverEnabled: true,
        failureThreshold: 2,
        failureWindowSeconds: 30,
        circuitBaseSeconds: 60,
        circuitMaxSeconds: 300,
        circuitBackoffMultiplier: 2,
        circuitJitterPercent: 10,
        circuitHalfOpenProbes: 1,
    },
]

const accessLogs = [
    {
        id: 401,
        listenerId: 11,
        username: 'route-user',
        requestedUsername: 'route-user#2',
        clientIp: '198.51.100.8',
        protocol: 'socks5',
        command: 'CONNECT',
        targetHost: 'api.example.test',
        targetPort: 443,
        upstreamProxyId: 232,
        status: 'success',
        bytesIn: 1024,
        bytesOut: 2048,
        durationMs: 120,
        routeStrategyId: 102,
        routeStrategyFlagNo: 4,
        primaryRouteStrategyId: 101,
        fallbackRouteStrategyId: 102,
        routeFailoverUsed: true,
        routeFailoverReason: 'primary route unavailable',
        routeCircuitState: 'open',
        routeCircuitCacheHit: true,
        routeCircuitProbe: false,
        proxyIndex: 2,
        resolvedProxyIndex: 2,
        proxyPoolSize: 3,
        targetRouteId: 301,
        targetRouteDefault: true,
        createdAt: '2026-07-22T08:00:00Z',
    },
]

function mockPayload(pathname) {
    if (pathname.endsWith('/proxy-gateway/listeners')) return listeners
    if (pathname.endsWith('/proxy-gateway/accounts')) return { items: accounts, total: accounts.length, page: 1, limit: 200 }
    if (pathname.endsWith('/proxy-gateway/account-groups')) return []
    if (pathname.endsWith('/proxy-gateway/account-tags')) return []
    if (pathname.endsWith('/proxy-gateway/route-strategies')) return routeStrategies
    if (pathname.endsWith('/proxy-gateway/target-routes')) return targetRoutes
    if (pathname.endsWith('/proxy-gateway/security-policies')) return []
    if (pathname.endsWith('/proxy-gateway/dns-policies')) return []
    if (pathname.endsWith('/proxy-gateway/logs')) return { items: accessLogs, total: accessLogs.length, page: 1, limit: 80 }
    if (pathname.endsWith('/proxy-gateway/audit-logs')) return []
    if (pathname.endsWith('/proxy-gateway/status')) return []
    if (pathname.endsWith('/proxy-groups')) return []
    if (pathname.endsWith('/proxy-tags')) return []
    if (pathname.endsWith('/proxy-pool')) return { items: [], total: 0, page: 1, limit: 500 }
    return undefined
}

async function configurePage(page, width, height) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async text => {
                    window.__proxyGatewayQACopiedText = text
                },
                readText: async () => window.__proxyGatewayQACopiedText || '',
            },
        })
    })
    await page.setRequestInterception(true)
    page.on('request', request => {
        const payload = mockPayload(new URL(request.url()).pathname)
        if (payload === undefined) {
            request.continue()
            return
        }
        request.respond({
            status: 200,
            contentType: 'application/json',
            headers: {
                'access-control-allow-origin': '*',
                'access-control-allow-headers': '*',
                'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
            },
            body: JSON.stringify(payload),
        })
    })
}

async function selectByLabel(page, label, value) {
    await page.evaluate(({ label, value }) => {
        const labels = Array.from(document.querySelectorAll('label'))
        const element = labels.find(item => item.innerText.includes(label))?.querySelector('select')
        if (!(element instanceof HTMLSelectElement)) throw new Error(`Select not found: ${label}`)
        element.value = value
        element.dispatchEvent(new Event('change', { bubbles: true }))
    }, { label, value })
}

async function setNumberByLabel(page, label, value) {
    await page.evaluate(({ label, value }) => {
        const labels = Array.from(document.querySelectorAll('label'))
        const element = labels.find(item => item.innerText.includes(label))?.querySelector('input[type="number"]')
        if (!(element instanceof HTMLInputElement)) throw new Error(`Number input not found: ${label}`)
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        if (!setter) throw new Error('Native number input setter unavailable')
        setter.call(element, String(value))
        element.dispatchEvent(new Event('input', { bubbles: true }))
    }, { label, value })
}

async function selectRadioByGroup(page, groupLabel, optionLabel) {
    await page.evaluate(({ groupLabel, optionLabel }) => {
        const group = document.querySelector(`[role="radiogroup"][aria-label="${groupLabel}"]`)
        const option = Array.from(group?.querySelectorAll('[role="radio"]') || [])
            .find(element => element.textContent?.trim() === optionLabel)
        if (!(option instanceof HTMLButtonElement)) throw new Error(`Radio option not found: ${groupLabel} / ${optionLabel}`)
        option.click()
    }, { groupLabel, optionLabel })
}

async function openExport(page) {
    await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForFunction(() => document.body.innerText.includes('route-user'), { timeout: 60_000 })
    await page.click('button[aria-label="批量导出智能路由代理"]')
    await page.waitForFunction(() => document.body.innerText.includes('批量导出智能路由代理'), { timeout: 10_000 })
}

function assert(condition, message) {
    if (!condition) throw new Error(message)
}

async function run() {
    const port = await getFreePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const server = spawn(nextBin, ['dev', '--hostname', '127.0.0.1', '--port', String(port)], {
        cwd: projectDir,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output = []
    server.stdout.on('data', chunk => output.push(chunk.toString()))
    server.stderr.on('data', chunk => output.push(chunk.toString()))

    let browser
    try {
        await waitForServer(`${baseUrl}${routePath}`, server)
        const executablePath = resolveChromeExecutable()
        if (!executablePath) throw new Error('Unable to find a Chrome executable for Puppeteer.')
        browser = await puppeteer.launch({
            headless: true,
            executablePath,
            timeout: 60_000,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })
        mkdirSync(artifactDir, { recursive: true })

        const desktop = await browser.newPage()
        await configurePage(desktop, 1440, 960)
        await desktop.goto(`${baseUrl}${routePath}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await desktop.waitForFunction(() => document.body.innerText.includes('route-user'), { timeout: 60_000 })

        const accountActions = await desktop.$$eval('tbody tr:first-child [aria-label]', elements => elements.map(element => element.getAttribute('aria-label')))
        assert(accountActions.includes('打开使用文档'), 'documentation action should use a semantic icon label')
        assert(accountActions.includes('查看接入代码'), 'code action should use a semantic icon label')
        assert(accountActions.includes('批量导出智能路由代理'), 'smart-routing account should expose export action')
        assert(accountActions.includes('编辑'), 'edit action should use the pencil action label')
        assert(accountActions.includes('删除'), 'delete action should retain its action label')
        const exportButtonCount = await desktop.$$eval('button[aria-label="批量导出智能路由代理"]', elements => elements.length)
        assert(exportButtonCount === 1, `only smart-routing accounts should expose export, received ${exportButtonCount}`)

        await desktop.click('button[aria-label="批量导出智能路由代理"]')
        await desktop.waitForSelector('pre code')
        const focusedOnOpen = await desktop.evaluate(() => document.activeElement?.tagName)
        assert(focusedOnOpen !== 'INPUT', 'export modal should not auto-open the gateway picker')
        const gatewayPickerAccessibility = await desktop.$eval('input[aria-label="代理网关"]', input => ({
            role: input.getAttribute('role'),
            hasClearButton: !!input.parentElement?.querySelector('button'),
        }))
        assert(gatewayPickerAccessibility.role === 'combobox', 'gateway picker should expose its combobox role')
        assert(!gatewayPickerAccessibility.hasClearButton, 'required gateway picker should not expose a no-op clear action')
        await setNumberByLabel(desktop, '生成数量', 2)
        await desktop.waitForFunction(() => (document.querySelector('pre code')?.textContent || '').split('\n').length === 2)
        let preview = await desktop.$eval('pre code', element => element.textContent || '')
        assert(preview.includes('http://route-user%231:secret-pass@[2001:db8::10]:19080'), 'HTTP URL should encode # and bracket IPv6')
        assert(preview.includes('http://route-user%232:secret-pass@[2001:db8::10]:19080'), 'sequential export should generate pool indexes 1 and 2')
        assert(!preview.includes('socks5://'), 'protocol selection must default to exactly one protocol')
        assert(preview.split('\n').length === 2, `generated quantity should equal output rows, received ${preview.split('\n').length}`)
        const activeProtocols = await desktop.$$eval('[role="radiogroup"][aria-label="代理协议"] [role="radio"][aria-checked="true"]', buttons => buttons.map(button => button.textContent?.trim()))
        assert(activeProtocols.length === 1 && activeProtocols[0] === 'HTTP', 'protocol selector should be a single-choice control')

        await setNumberByLabel(desktop, '生成数量', 20)
        await desktop.waitForFunction(() => (document.querySelector('pre code')?.textContent || '').split('\n').length === 20)
        preview = await desktop.$eval('pre code', element => element.textContent || '')
        assert(preview.includes('route-user%2320'), 'pool-index export quantity must not be capped by the number of route strategies')

        await setNumberByLabel(desktop, '生成数量', 1)
        await desktop.waitForFunction(() => (document.querySelector('pre code')?.textContent || '').split('\n').length === 1)
        preview = await desktop.$eval('pre code', element => element.textContent || '')
        assert(preview.includes('%231') && !preview.includes('%232'), 'quantity one should generate exactly pool index one')

        await selectByLabel(desktop, '用户名分隔符', '--')
        await desktop.waitForFunction(() => document.querySelector('pre code')?.textContent?.includes('--1'))
        preview = await desktop.$eval('pre code', element => element.textContent || '')
        assert(preview.includes('route-user--1'), 'custom multi-character separator should be exported')

        await selectRadioByGroup(desktop, '代理协议', 'SOCKS5')
        await desktop.waitForFunction(() => {
            const text = document.querySelector('pre code')?.textContent || ''
            return text.startsWith('socks5://') && !text.includes('\nhttp://')
        })
        preview = await desktop.$eval('pre code', element => element.textContent || '')
        assert(preview.split('\n').length === 1, 'switching protocol must preserve the requested generated quantity')

        const exportFormats = await desktop.$$eval('label', labels => {
            const select = labels.find(label => label.innerText.includes('导出格式'))?.querySelector('select')
            return Array.from(select?.options || []).map(option => option.value)
        })
        assert(exportFormats.length === 8, `export format selector should expose eight practical templates, received ${exportFormats.length}`)

        const formatExpectations = [
            ['auth-at-host', 'route-user--1:secret-pass@[2001:db8::10]:19080'],
            ['host-port-auth', '[2001:db8::10]:19080:route-user--1:secret-pass'],
            ['host-port-at-auth', '[2001:db8::10]:19080@route-user--1:secret-pass'],
            ['auth-host-port', 'route-user--1:secret-pass:[2001:db8::10]:19080'],
            ['csv', 'socks5,2001:db8::10,19080,route-user--1,secret-pass'],
            ['tsv', 'socks5\t2001:db8::10\t19080\troute-user--1\tsecret-pass'],
        ]
        for (const [format, expected] of formatExpectations) {
            await selectByLabel(desktop, '导出格式', format)
            await desktop.waitForFunction(expectedText => document.querySelector('pre code')?.textContent === expectedText, {}, expected)
        }

        await selectByLabel(desktop, '导出格式', 'jsonl')
        await desktop.waitForFunction(() => document.querySelector('pre code')?.textContent?.startsWith('{"protocol":"socks5"'))
        preview = await desktop.$eval('pre code', element => element.textContent || '')
        const jsonLine = JSON.parse(preview)
        assert(jsonLine.username === 'route-user--1' && jsonLine.host === '2001:db8::10', 'JSON Lines should preserve structured proxy fields')

        await setNumberByLabel(desktop, '生成数量', 4)
        await selectRadioByGroup(desktop, '索引生成方式', '随机数')
        await desktop.waitForSelector('button')
        await selectByLabel(desktop, '导出格式', 'url')
        await desktop.waitForFunction(() => (document.querySelector('pre code')?.textContent || '').split('\n').length === 4)
        const randomIndexes = await desktop.$$eval('[aria-label="已生成池内代理索引"] span', badges => badges.map(badge => badge.textContent?.trim()))
        assert(randomIndexes.length === 4 && new Set(randomIndexes).size === 4, 'random mode should generate the requested number of distinct indexes')
        assert(randomIndexes.every(index => /^--\d+$/.test(index || '')), `random mode must generate positive integer indexes, received ${randomIndexes.join(', ')}`)
        assert(randomIndexes.some(index => Number(index?.slice(2)) > 4), 'random mode should generate random numbers instead of only shuffling 1 to N')
        await desktop.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.textContent?.trim() === '重新随机')
            if (!(button instanceof HTMLButtonElement)) throw new Error('Re-randomize action not found')
            button.click()
        })
        await selectRadioByGroup(desktop, '索引生成方式', '顺序')
        await setNumberByLabel(desktop, '生成数量', 1)
        await desktop.waitForFunction(() => document.querySelector('pre code')?.textContent?.includes('route-user--1'))
        preview = await desktop.$eval('pre code', element => element.textContent || '')

        await desktop.bringToFront()
        await desktop.click('button[aria-label="复制导出的代理配置"]')
        await delay(500)
        const clipboardText = await desktop.evaluate(async () => {
            try {
                return await navigator.clipboard.readText()
            } catch (error) {
                return `clipboard error: ${error instanceof Error ? error.message : String(error)}`
            }
        })
        assert(clipboardText === preview, `copy action should write the exact export preview; received ${clipboardText}`)
        await desktop.evaluate(() => {
            navigator.clipboard.writeText = async () => {
                throw new Error('secure clipboard unavailable')
            }
            document.execCommand = command => {
                if (command !== 'copy') return false
                window.__proxyGatewayQAFallbackText = document.querySelector('textarea[readonly]')?.value || ''
                return true
            }
        })
        await desktop.click('button[aria-label="复制导出的代理配置"]')
        await delay(100)
        const fallbackClipboardText = await desktop.evaluate(() => window.__proxyGatewayQAFallbackText || '')
        assert(fallbackClipboardText === preview, 'copy action should fall back when the secure clipboard API is unavailable')

        await delay(300)
        const modalMetrics = await desktop.$eval('[role="dialog"]', element => {
            const rect = element.getBoundingClientRect()
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width }
        })
        assert(modalMetrics.left >= 0 && modalMetrics.right <= 1440, 'desktop export modal should stay inside viewport')
        await desktop.screenshot({ path: join(artifactDir, 'desktop.png'), fullPage: true })

        await desktop.click('input[aria-label="代理网关"]')
        await desktop.type('input[aria-label="代理网关"]', 'QA Socks')
        await desktop.waitForFunction(() => document.body.innerText.includes('QA Socks Gateway'))
        await desktop.evaluate(() => {
            const option = Array.from(document.querySelectorAll('button')).find(element => element.innerText.includes('QA Socks Gateway'))
            if (!(option instanceof HTMLButtonElement)) throw new Error('SOCKS gateway option not found')
            option.click()
        })
        await desktop.waitForFunction(() => {
            const separator = Array.from(document.querySelectorAll('label'))
                .find(element => element.innerText.includes('用户名分隔符'))
                ?.querySelector('select')?.value
            const preview = document.querySelector('pre code')?.textContent || ''
            return separator === '~' && preview.includes('socks5://route-user~1:secret-pass@proxy.example.test:19081') && !preview.includes('http://')
        })
        const switchedProtocols = await desktop.$$eval('[role="radiogroup"][aria-label="代理协议"] [role="radio"][aria-checked="true"]', buttons => buttons.map(button => button.textContent?.trim()))
        assert(switchedProtocols.length === 1 && switchedProtocols[0] === 'SOCKS5', 'gateway switching should synchronously constrain supported protocols')
        await selectByLabel(desktop, '导出格式', 'jsonl')
        await desktop.waitForFunction(() => document.querySelector('pre code')?.textContent?.startsWith('{"protocol":"socks5"'))
        const jsonLines = await desktop.$eval('pre code', element => (element.textContent || '').split('\n').filter(Boolean).map(line => JSON.parse(line)))
        assert(jsonLines.every(item => item.protocol === 'socks5' && item.host === 'proxy.example.test' && item.username.includes('~')), 'JSON Lines should reflect the switched gateway, protocol, and separator')

        const mobile = await browser.newPage()
        await configurePage(mobile, 390, 844)
        await mobile.goto(`${baseUrl}${routePath}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await mobile.waitForFunction(() => document.body.innerText.includes('route-user'), { timeout: 60_000 })
        await mobile.click('button[aria-label="批量导出智能路由代理"]')
        await mobile.waitForSelector('[role="dialog"]')
        await delay(300)
        const mobileMetrics = await mobile.$eval('[role="dialog"]', element => {
            const rect = element.getBoundingClientRect()
            return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                bodyScrollWidth: document.body.scrollWidth,
            }
        })
        assert(mobileMetrics.left >= 0 && mobileMetrics.right <= mobileMetrics.viewportWidth, 'mobile export modal should not overflow horizontally')
        assert(mobileMetrics.bodyScrollWidth <= mobileMetrics.viewportWidth, 'mobile page should not create horizontal body overflow')
        assert(mobileMetrics.top >= 0 && mobileMetrics.bottom <= mobileMetrics.viewportHeight, 'mobile export modal should fit vertically with internal scrolling')
        await mobile.screenshot({ path: join(artifactDir, 'mobile.png'), fullPage: true })

        const gatewayPage = await browser.newPage()
        await configurePage(gatewayPage, 1280, 900)
        await gatewayPage.goto(`${baseUrl}${routePath}?section=gateways`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await gatewayPage.waitForFunction(() => document.body.innerText.includes('QA Mixed Gateway'), { timeout: 60_000 })
        await gatewayPage.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.innerText.includes('新增网关'))
            if (!(button instanceof HTMLButtonElement)) throw new Error('Create gateway button not found')
            button.click()
        })
        await gatewayPage.waitForFunction(() => document.body.innerText.includes('智能用户名分隔符'))
        const defaultSeparator = await gatewayPage.evaluate(() => {
            const label = Array.from(document.querySelectorAll('label')).find(element => element.innerText.includes('智能用户名分隔符'))
            const textarea = label?.querySelector('textarea')
            return textarea?.value
        })
        assert(defaultSeparator === '#', `new gateways should default to #, received ${defaultSeparator}`)
        await gatewayPage.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.textContent?.trim() === '取消')
            if (!(button instanceof HTMLButtonElement)) throw new Error('Cancel gateway action not found')
            button.click()
        })
        await gatewayPage.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.textContent?.trim() === '配置策略')
            if (!(button instanceof HTMLButtonElement)) throw new Error('Configure gateway action not found')
            button.click()
        })
        await gatewayPage.waitForFunction(() => document.body.innerText.includes('返回网关列表'))
        await gatewayPage.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.textContent?.trim() === '出口策略')
            if (!(button instanceof HTMLButtonElement)) throw new Error('Route strategies navigation not found')
            button.click()
        })
        await gatewayPage.waitForFunction(() => document.body.innerText.includes('池内索引账号的 #N 不选择策略'))
        await gatewayPage.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.textContent?.trim() === '新增出口策略')
            if (!(button instanceof HTMLButtonElement)) throw new Error('Create route strategy action not found')
            button.click()
        })
        await gatewayPage.waitForFunction(() => document.body.innerText.includes('新增出口策略'))
        const nextFlagNo = await gatewayPage.evaluate(() => {
            const label = Array.from(document.querySelectorAll('label')).find(element => element.innerText.includes('标志号'))
            return label?.querySelector('input[type="number"]')?.value
        })
        assert(nextFlagNo === '2', `new route strategies should choose the first unused gateway flag, received ${nextFlagNo}`)
        await gatewayPage.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.textContent?.includes('代理选择'))
            if (!(button instanceof HTMLButtonElement)) throw new Error('Proxy selection wizard step not found')
            button.click()
        })
        await gatewayPage.waitForFunction(() => document.body.innerText.includes('索引越界'))
        const defaultOverflowMode = await gatewayPage.evaluate(() => {
            const label = Array.from(document.querySelectorAll('label')).find(element => element.innerText.includes('索引越界'))
            return label?.querySelector('select')?.value
        })
        assert(defaultOverflowMode === 'reject', `new route strategies should default to strict index overflow, received ${defaultOverflowMode}`)
        await gatewayPage.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]')
            const button = Array.from(dialog?.querySelectorAll('button') || []).find(element => element.textContent?.trim() === '取消')
            if (!(button instanceof HTMLButtonElement)) throw new Error('Cancel route strategy action not found')
            button.click()
        })
        await gatewayPage.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.textContent?.trim() === '目标路由')
            if (!(button instanceof HTMLButtonElement)) throw new Error('Target routes navigation not found')
            button.click()
        })
        await gatewayPage.waitForFunction(() => document.body.innerText.includes('新增目标路由'))
        await gatewayPage.waitForFunction(() => document.body.innerText.includes('缺失兜底策略测试') && document.body.innerText.includes('关联策略不可用'))
        await gatewayPage.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.textContent?.trim() === '新增目标路由')
            if (!(button instanceof HTMLButtonElement)) throw new Error('Create target route action not found')
            button.click()
        })
        await gatewayPage.waitForFunction(() => document.body.innerText.includes('失败切换'))
        const failoverInitiallyHidden = await gatewayPage.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]')
            return !dialog?.innerText.includes('兜底出口策略')
        })
        assert(failoverInitiallyHidden, 'advanced failover fields should stay hidden until failover is enabled')
        await gatewayPage.evaluate(() => {
            const section = Array.from(document.querySelectorAll('[role="dialog"] section')).find(element => element.innerText.includes('失败切换'))
            const checkbox = section?.querySelector('input[type="checkbox"]')
            if (!(checkbox instanceof HTMLInputElement)) throw new Error('Failover toggle not found')
            checkbox.click()
        })
        await gatewayPage.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('兜底出口策略'))
        const failoverDefaults = await gatewayPage.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]')
            const numberValue = labelText => {
                const label = Array.from(dialog?.querySelectorAll('label') || []).find(element => element.innerText.includes(labelText))
                return label?.querySelector('input[type="number"]')?.value
            }
            const details = dialog?.querySelector('details')
            return {
                threshold: numberValue('失败阈值'),
                base: numberValue('初始退避'),
                maximum: numberValue('最大退避'),
                advancedOpen: details?.hasAttribute('open'),
            }
        })
        assert(failoverDefaults.threshold === '2', `failover threshold default should be 2, received ${failoverDefaults.threshold}`)
        assert(failoverDefaults.base === '60' && failoverDefaults.maximum === '300', `failover backoff defaults should be 60–300, received ${failoverDefaults.base}–${failoverDefaults.maximum}`)
        assert(!failoverDefaults.advancedOpen, 'advanced circuit controls should use progressive disclosure')
        await gatewayPage.click('[role="dialog"] details summary')
        const advancedDefaults = await gatewayPage.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]')
            const numberValue = labelText => {
                const label = Array.from(dialog?.querySelectorAll('label') || []).find(element => element.innerText.includes(labelText))
                return label?.querySelector('input[type="number"]')?.value
            }
            return {
                window: numberValue('统计窗口'),
                multiplier: numberValue('退避倍数'),
                jitter: numberValue('抖动比例'),
                probes: numberValue('半开探测数'),
            }
        })
        assert(JSON.stringify(advancedDefaults) === JSON.stringify({ window: '30', multiplier: '2', jitter: '10', probes: '1' }), `unexpected advanced failover defaults: ${JSON.stringify(advancedDefaults)}`)
        const targetRouteModalMetrics = await gatewayPage.$eval('[role="dialog"]', element => {
            const rect = element.getBoundingClientRect()
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
        })
        assert(targetRouteModalMetrics.left >= 0 && targetRouteModalMetrics.right <= 1280, 'target route failover modal should stay inside the desktop viewport')
        await gatewayPage.screenshot({ path: join(artifactDir, 'target-route-failover.png'), fullPage: true })
        await gatewayPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
        await delay(300)
        const targetRouteMobileMetrics = await gatewayPage.$eval('[role="dialog"]', element => {
            const rect = element.getBoundingClientRect()
            return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                bodyScrollWidth: document.body.scrollWidth,
            }
        })
        assert(targetRouteMobileMetrics.left >= 0 && targetRouteMobileMetrics.right <= targetRouteMobileMetrics.viewportWidth, 'target route failover modal should not overflow the mobile viewport')
        assert(targetRouteMobileMetrics.top >= 0 && targetRouteMobileMetrics.bottom <= targetRouteMobileMetrics.viewportHeight, 'target route failover modal should use internal scrolling on mobile')
        assert(targetRouteMobileMetrics.bodyScrollWidth <= targetRouteMobileMetrics.viewportWidth, 'target route failover modal should not create horizontal body scrolling')
        await gatewayPage.screenshot({ path: join(artifactDir, 'target-route-failover-mobile.png'), fullPage: true })
        await gatewayPage.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]')
            const button = Array.from(dialog?.querySelectorAll('button') || []).find(element => element.textContent?.trim() === '取消')
            if (!(button instanceof HTMLButtonElement)) throw new Error('Cancel target route action not found')
            button.click()
        })
        await gatewayPage.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
        await gatewayPage.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.textContent?.trim() === '网关日志')
            if (!(button instanceof HTMLButtonElement)) throw new Error('Gateway logs navigation not found')
            button.click()
        })
        await gatewayPage.waitForFunction(() => document.body.innerText.includes('失败切换 → 策略 #102') && document.body.innerText.includes('熔断缓存命中'))
        const failoverLogText = await gatewayPage.evaluate(() => document.body.innerText)
        assert(failoverLogText.includes('api.example.test:443'), 'gateway log should display the destination host and port')
        assert(failoverLogText.includes('主策略失败：primary route unavailable'), 'gateway log should label the primary failure reason on a successful failover')
        assert(failoverLogText.includes('熔断 open'), 'gateway log should display the circuit state')
        const failoverLogMetrics = await gatewayPage.evaluate(() => {
            const table = Array.from(document.querySelectorAll('table')).find(element => element.innerText.includes('熔断缓存命中'))
            const row = table?.querySelector('tbody tr')
            return {
                viewportWidth: window.innerWidth,
                bodyScrollWidth: document.body.scrollWidth,
                tableWidth: table?.getBoundingClientRect().width || 0,
                rowHeight: row?.getBoundingClientRect().height || 0,
            }
        })
        assert(failoverLogMetrics.bodyScrollWidth <= failoverLogMetrics.viewportWidth, 'gateway logs should not create horizontal body scrolling')
        assert(failoverLogMetrics.tableWidth >= 900, 'gateway log columns should keep a readable minimum width')
        assert(failoverLogMetrics.rowHeight < 180, 'gateway log rows should not collapse into excessive wrapped lines')
        await gatewayPage.screenshot({ path: join(artifactDir, 'gateway-failover-log.png'), fullPage: true })

        console.log(JSON.stringify({
            status: 'ok',
            accountActions,
            exportRows: preview.split('\n').length,
            desktopModal: modalMetrics,
            mobileModal: mobileMetrics,
            defaultGatewaySeparator: defaultSeparator,
            nextRouteStrategyFlag: nextFlagNo,
            defaultIndexOverflowMode: defaultOverflowMode,
            failoverDefaults,
            advancedFailoverDefaults: advancedDefaults,
            targetRouteModal: targetRouteModalMetrics,
            targetRouteMobileModal: targetRouteMobileMetrics,
            failoverLogMetrics,
            artifacts: artifactDir,
        }, null, 2))
    } catch (error) {
        console.error(output.join(''))
        throw error
    } finally {
        if (browser) await browser.close()
        server.kill('SIGTERM')
    }
}

run().catch(error => {
    console.error(error)
    process.exitCode = 1
})
