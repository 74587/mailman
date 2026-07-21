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

function mockPayload(pathname) {
    if (pathname.endsWith('/proxy-gateway/listeners')) return listeners
    if (pathname.endsWith('/proxy-gateway/accounts')) return { items: accounts, total: accounts.length, page: 1, limit: 200 }
    if (pathname.endsWith('/proxy-gateway/account-groups')) return []
    if (pathname.endsWith('/proxy-gateway/account-tags')) return []
    if (pathname.endsWith('/proxy-gateway/route-strategies')) return routeStrategies
    if (pathname.endsWith('/proxy-gateway/target-routes')) return []
    if (pathname.endsWith('/proxy-gateway/security-policies')) return []
    if (pathname.endsWith('/proxy-gateway/dns-policies')) return []
    if (pathname.endsWith('/proxy-gateway/logs')) return { items: [], total: 0, page: 1, limit: 80 }
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
        let preview = await desktop.$eval('pre code', element => element.textContent || '')
        assert(preview.includes('http://route-user%234:secret-pass@[2001:db8::10]:19080'), 'HTTP URL should encode # and bracket IPv6')
        assert(preview.includes('socks5://route-user%236:secret-pass@[2001:db8::10]:19080'), 'SOCKS5 URL should include authorized gateway flag 6')
        assert(!preview.includes('%231'), 'a shadowed global strategy must not be exported when its gateway-specific winner is unauthorized')
        assert(!preview.includes('%239'), 'unauthorized route flag must not be exported')
        assert(preview.split('\n').length === 4, `duplicate flags should collapse to four protocol rows, received ${preview.split('\n').length}`)

        await selectByLabel(desktop, '用户名分隔符', '--')
        await desktop.waitForFunction(() => document.querySelector('pre code')?.textContent?.includes('--4'))
        preview = await desktop.$eval('pre code', element => element.textContent || '')
        assert(preview.includes('route-user--4'), 'custom multi-character separator should be exported')

        await desktop.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.innerText.trim() === 'HTTP')
            if (!(button instanceof HTMLButtonElement)) throw new Error('HTTP protocol toggle not found')
            button.click()
        })
        await desktop.waitForFunction(() => {
            const text = document.querySelector('pre code')?.textContent || ''
            return text.startsWith('socks5://') && !text.includes('\nhttp://')
        })
        preview = await desktop.$eval('pre code', element => element.textContent || '')
        assert(preview.split('\n').length === 2, 'protocol selection should immediately narrow exported rows')
        await desktop.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element => element.innerText.trim() === 'HTTP')
            if (!(button instanceof HTMLButtonElement)) throw new Error('HTTP protocol toggle not found')
            button.click()
        })

        await selectByLabel(desktop, '导出格式', 'csv')
        await desktop.waitForFunction(() => document.querySelector('pre code')?.textContent?.includes('http,'))
        preview = await desktop.$eval('pre code', element => element.textContent || '')
        assert(preview.includes('http,2001:db8::10,19080,route-user--4,secret-pass'), 'CSV export should keep raw credentials in five columns')
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
            return separator === '~' && preview.includes('socks5,proxy.example.test,19081,route-user~1') && !preview.includes('http,')
        })
        const switchedProtocols = await desktop.$$eval('button[aria-pressed]', buttons => buttons.map(button => button.textContent?.trim()))
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

        console.log(JSON.stringify({
            status: 'ok',
            accountActions,
            exportRows: preview.split('\n').length,
            desktopModal: modalMetrics,
            mobileModal: mobileMetrics,
            defaultGatewaySeparator: defaultSeparator,
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
