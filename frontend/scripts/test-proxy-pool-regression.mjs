import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectDir = dirname(scriptDir)
const nextBin = join(projectDir, 'node_modules', '.bin', 'next')
const routePath = '/dev/proxy-pool-regression'
const artifactDir = process.env.PROXY_POOL_QA_ARTIFACT_DIR || '/tmp/mailman-proxy-pool-qa'
const requestsSeen = []
let partialImport = true

const channels = [
    { id: 1, orgId: 1, key: 'ip-sb', name: 'IP.SB', provider: 'api.ip.sb', description: '双栈出口检测', mode: 'self', urlTemplate: 'https://api.ip.sb/geoip', method: 'GET', responseFormat: 'json', ipField: 'ip', authType: 'none', hasCredential: false, enabled: true, builtIn: true, supportsIPv4: true, supportsIPv6: true, timeoutSeconds: 12, sortOrder: 10 },
    { id: 2, orgId: 1, key: 'ipinfo', name: 'IPinfo', provider: 'ipinfo.io', description: '双栈出口检测', mode: 'self', urlTemplate: 'https://ipinfo.io/json', method: 'GET', responseFormat: 'json', ipField: 'ip', authType: 'query', authName: 'token', hasCredential: true, enabled: true, builtIn: true, supportsIPv4: true, supportsIPv6: true, timeoutSeconds: 12, sortOrder: 20 },
    { id: 3, orgId: 1, key: 'ipqualityscore', name: 'IPQualityScore', provider: 'ipqualityscore.com', description: 'IP 风险查询', mode: 'lookup', urlTemplate: 'https://ipqualityscore.com/api/json/ip/{{credential}}/{{ip}}', method: 'GET', responseFormat: 'json', authType: 'path', hasCredential: false, enabled: false, builtIn: true, supportsIPv4: true, supportsIPv6: true, timeoutSeconds: 12, sortOrder: 30 },
]

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            server.close(() => typeof address === 'string' || !address ? reject(new Error('No port')) : resolve(address.port))
        })
    })
}

async function waitForServer(url, process) {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
        if (process.exitCode !== null) throw new Error(`Next dev server exited with ${process.exitCode}`)
        try {
            const response = await fetch(url)
            if (response.status < 500) return
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 400))
    }
    throw new Error(`Timed out waiting for ${url}`)
}

function chromePath() {
    const candidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        (() => { try { return puppeteer.executablePath() } catch { return undefined } })(),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
    ]
    return candidates.find(candidate => candidate && existsSync(candidate))
}

function jsonResponse(request, payload, status = 200) {
    return request.respond({
        status,
        contentType: 'application/json',
        headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        },
        body: JSON.stringify(payload),
    })
}

async function configure(page, width, height) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await page.setRequestInterception(true)
    page.on('request', async request => {
        const parsed = new URL(request.url())
        if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.port !== '8080') return request.continue()
        const apiPath = parsed.pathname.replace(/^\/api/, '')
        requestsSeen.push({ method: request.method(), url: parsed.toString(), body: request.postData() || '' })
        if (request.method() === 'OPTIONS') return jsonResponse(request, {}, 204)
        if (apiPath === '/proxy-pool/check-channels/test') {
            const body = JSON.parse(request.postData() || '{}')
            const regexMode = body.channel?.responseFormat === 'regex'
            return jsonResponse(request, {
                success: true,
                httpStatus: 200,
                latencyMs: 84,
                contentType: regexMode ? 'text/plain; charset=utf-8' : 'application/json',
                rawBody: regexMode ? 'IP=203.0.113.42; status=ok' : '{"ip":"203.0.113.42","status":"ok"}',
                exitIp: '203.0.113.42',
                captures: regexMode ? ['IP=203.0.113.42; status=ok', '203.0.113.42', 'ok'] : undefined,
                statusValue: 'ok',
                failureValue: body.channel?.failureValue || '',
                failureMatched: false,
                decision: '响应成功，字段映射与失败判定通过',
            })
        }
        if (apiPath === '/proxy-pool/check-channels') {
            return jsonResponse(request, parsed.searchParams.get('includeDisabled') === 'true' ? channels : channels.filter(channel => channel.enabled))
        }
        if (apiPath.startsWith('/proxy-pool/check-channels/')) return jsonResponse(request, channels[0])
        if (apiPath === '/proxy-pool/bulk-import') {
            const body = JSON.parse(request.postData() || '{}')
            const submitted = String(body.content || '').split('\n').filter(Boolean).length
            if (partialImport) {
                partialImport = false
                return jsonResponse(request, { created: [], errors: [{ line: submitted, content: 'bad-row', error: '测试导入错误' }], checks: [], summary: { processed: submitted - 1, created: submitted - 1, updated: 0, skipped: 0, errors: 1, submitted } })
            }
            return jsonResponse(request, { created: [], errors: [], checks: [], summary: { processed: submitted, created: submitted, updated: 0, skipped: 0, errors: 0, submitted } })
        }
        if (/^\/proxy-pool\/\d+\/test$/.test(apiPath)) {
            const id = Number(apiPath.split('/')[2])
            return jsonResponse(request, { proxyId: id, success: true, status: 'available', latencyMs: 55, exitIp: '203.0.113.10', checkChannel: 'ip-sb', usedChannel: 'ip-sb' })
        }
        if (/^\/proxy-pool\/\d+$/.test(apiPath)) {
            const id = Number(apiPath.split('/')[2])
            return jsonResponse(request, { id, orgId: 1, type: 'socks5', host: `proxy-page-${id}.example`, port: 1080, status: 'available', tags: [], checkLatencyMs: 55, exitIp: '203.0.113.10', trafficBytesIn: 1024, trafficBytesOut: 2048 })
        }
        if (apiPath === '/proxy-pool') {
            const pageNumber = Number(parsed.searchParams.get('page') || 1)
            const limit = Number(parsed.searchParams.get('limit') || 30)
            const search = parsed.searchParams.get('search') || ''
            if (search === 'slow') await new Promise(resolve => setTimeout(resolve, 350))
            if (search === 'fast') await new Promise(resolve => setTimeout(resolve, 10))
            return jsonResponse(request, {
                items: [{ id: pageNumber, orgId: 1, type: 'socks5', host: search ? `proxy-${search}.example` : `proxy-page-${pageNumber}.example`, port: 1080, status: 'available', tags: [], trafficBytesIn: 1024, trafficBytesOut: 2048 }],
                total: search ? 1 : 2000,
                page: pageNumber,
                limit,
                trafficSummary: { trafficBytesIn: 1024, trafficBytesOut: 2048 },
            })
        }
        if (apiPath === '/proxy-groups' || apiPath === '/proxy-tags') return jsonResponse(request, [])
        return jsonResponse(request, {})
    })
}

function assert(value, message) {
    if (!value) throw new Error(message)
}

async function clickButton(page, label) {
    await page.evaluate(label => {
        const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === label)
        if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`)
        button.click()
    }, label)
}

async function clickVisibleTitle(page, title) {
    await page.evaluate(title => {
        const button = Array.from(document.querySelectorAll(`button[title="${title}"]`)).find(item => {
            const rect = item.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
        })
        if (!(button instanceof HTMLButtonElement)) throw new Error(`Visible titled button not found: ${title}`)
        button.click()
    }, title)
}

async function run() {
    const port = await getFreePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const server = spawn(nextBin, ['dev', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: projectDir, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'pipe' })
    let browser
    try {
        await waitForServer(`${baseUrl}${routePath}`, server)
        browser = await puppeteer.launch({ headless: true, executablePath: chromePath(), args: ['--no-sandbox'] })
        mkdirSync(artifactDir, { recursive: true })
        const page = await browser.newPage()
        await configure(page, 1280, 900)
        await page.goto(`${baseUrl}${routePath}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await page.waitForFunction(() => document.body.innerText.includes('代理池管理') && document.body.innerText.includes('共 2000 条'))

        await page.evaluate(() => new Promise(resolve => window.setTimeout(resolve, 250)))
        const listRequestsBeforeCheck = requestsSeen.filter(item => new URL(item.url).pathname === '/api/proxy-pool').length
        await page.click('button[title="检测"]')
        await page.waitForFunction(() => document.body.innerText.includes('203.0.113.10'))
        const listRequestsAfterCheck = requestsSeen.filter(item => new URL(item.url).pathname === '/api/proxy-pool').length
        assert(listRequestsAfterCheck === listRequestsBeforeCheck, 'single proxy check reloaded and potentially reordered the whole list')
        assert(requestsSeen.some(item => new URL(item.url).pathname === '/api/proxy-pool/1' && item.method === 'GET'), 'single proxy check did not refresh the tested row in place')

        await page.click('input[aria-label="每页数量"]', { clickCount: 3 })
        await page.type('input[aria-label="每页数量"]', '750')
        await page.keyboard.press('Enter')
        await page.waitForFunction(() => document.body.innerText.includes('第 1 / 3 页'))
        await page.click('input[aria-label="跳转页码"]', { clickCount: 3 })
        await page.type('input[aria-label="跳转页码"]', '3')
        await page.keyboard.press('Enter')
        await page.waitForFunction(() => document.body.innerText.includes('第 3 / 3 页'))
        assert(requestsSeen.some(item => item.url.includes('limit=750') && item.url.includes('page=3')), 'pagination request did not preserve custom unlimited page size')
        await page.screenshot({ path: join(artifactDir, 'pagination-desktop.png'), fullPage: true })

        const searchInput = 'input[placeholder*="搜索主机"]'
        await page.click(searchInput, { clickCount: 3 })
        await page.type(searchInput, 'slow')
        await page.keyboard.press('Enter')
        await page.evaluate(() => new Promise(resolve => window.setTimeout(resolve, 40)))
        await page.click(searchInput, { clickCount: 3 })
        await page.type(searchInput, 'fast')
        await page.keyboard.press('Enter')
        await page.waitForFunction(() => document.body.innerText.includes('proxy-fast.example'))
        await page.evaluate(() => new Promise(resolve => window.setTimeout(resolve, 400)))
        assert(await page.evaluate(() => !document.body.innerText.includes('proxy-slow.example')), 'stale search response overwrote the latest result')

        await clickButton(page, '检测渠道')
        await page.waitForFunction(() => document.body.innerText.includes('IPQualityScore') && document.body.innerText.includes('3 个已配置'))
        await page.evaluate(() => new Promise(resolve => window.setTimeout(resolve, 400)))
        const channelModal = await page.$eval('[role="dialog"]', element => {
            const rect = element.getBoundingClientRect()
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight }
        })
        assert(channelModal.left >= 0 && channelModal.right <= channelModal.width && channelModal.top >= 0 && channelModal.bottom <= channelModal.height, 'channel modal overflows desktop viewport')
        await page.screenshot({ path: join(artifactDir, 'channels-desktop.png'), fullPage: true })
        await clickVisibleTitle(page, '编辑')
        await page.waitForFunction(() => document.body.innerText.includes('编辑 IP.SB') && document.body.innerText.includes('渠道试运行'))
        await clickButton(page, '试运行当前配置')
        await page.waitForFunction(() => document.body.innerText.includes('原始响应') && document.body.innerText.includes('203.0.113.42'))
        await page.evaluate(() => {
            const label = Array.from(document.querySelectorAll('label')).find(item => item.textContent?.includes('响应格式'))
            const select = label?.querySelector('select')
            if (!(select instanceof HTMLSelectElement)) throw new Error('Response format selector not found')
            select.value = 'regex'
            select.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await page.waitForFunction(() => document.body.innerText.includes('响应正则') && document.body.innerText.includes('正则捕获组') === false)
        await page.evaluate(() => {
            const setValue = (labelText, value) => {
                const label = Array.from(document.querySelectorAll('label')).find(item => item.textContent?.includes(labelText))
                const input = label?.querySelector('input, textarea')
                if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) throw new Error(`Field not found: ${labelText}`)
                const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
                Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value)
                input.dispatchEvent(new Event('input', { bubbles: true }))
            }
            setValue('响应正则', 'IP=([0-9.]+); status=(\\w+)')
            setValue('出口 IP 字段', '$1')
            setValue('状态字段', '$2')
            setValue('失败值', 'fail')
        })
        await clickButton(page, '试运行当前配置')
        await page.waitForFunction(() => document.body.innerText.includes('$1 = 203.0.113.42') && document.body.innerText.includes('$2 = ok'))
        await page.$eval('[data-testid="channel-test-result"]', element => element.scrollIntoView({ block: 'center' }))
        await page.screenshot({ path: join(artifactDir, 'channel-regex-trial-desktop.png'), fullPage: true })
        await clickButton(page, '返回列表')
        await clickButton(page, '关闭')

        await clickButton(page, '批量新增')
        const content = Array.from({ length: 2000 }, (_, index) => `10.0.${Math.floor(index / 255)}.${index % 255}:${10000 + index}`).join('\n')
        await page.$eval('textarea[placeholder*="一行一个代理"]', (element, value) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
            setter?.call(element, value)
            element.dispatchEvent(new Event('input', { bubbles: true }))
        }, content)
        await page.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('导入检测'))
            if (!(button instanceof HTMLButtonElement)) throw new Error('Import finish step not found')
            button.click()
        })
        await clickButton(page, '导入')
        await page.waitForFunction(() => document.body.innerText.includes('服务端返回 1 条导入错误'))
        assert(await page.$('[role="dialog"]') !== null, 'partial import result should remain visible')
        await clickButton(page, '导入')
        await page.waitForFunction(() => !document.body.innerText.includes('批量新增代理'))
        const importRequest = requestsSeen.filter(item => item.url.includes('/bulk-import')).at(-1)
        assert(importRequest && JSON.parse(importRequest.body).content.split('\n').length === 2000, 'bulk import did not submit all 2000 rows')

        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
        await page.waitForFunction(() => !document.body.innerText.includes('已处理 2000 个代理'), { timeout: 10_000 })
        await clickButton(page, '检测渠道')
        await page.waitForFunction(() => document.body.innerText.includes('IPQualityScore'))
        await page.evaluate(() => new Promise(resolve => window.setTimeout(resolve, 400)))
        const mobile = await page.$eval('[role="dialog"]', element => {
            const rect = element.getBoundingClientRect()
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, bodyWidth: document.body.scrollWidth, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }
        })
        assert(mobile.left >= 0 && mobile.right <= mobile.viewportWidth && mobile.top >= 0 && mobile.bottom <= mobile.viewportHeight, 'channel modal overflows mobile viewport')
        assert(mobile.bodyWidth <= mobile.viewportWidth, 'proxy pool creates mobile body overflow')
        await page.screenshot({ path: join(artifactDir, 'channels-mobile.png'), fullPage: true })
        await clickVisibleTitle(page, '编辑')
        await page.waitForFunction(() => document.body.innerText.includes('编辑 IP.SB') && document.body.innerText.includes('渠道试运行'))
        await clickButton(page, '试运行当前配置')
        await page.waitForSelector('[data-testid="channel-test-result"]')
        await page.$eval('[data-testid="channel-test-result"]', element => element.scrollIntoView({ block: 'start' }))
        const mobileTrialWidth = await page.evaluate(() => ({ bodyWidth: document.body.scrollWidth, viewportWidth: window.innerWidth }))
        assert(mobileTrialWidth.bodyWidth <= mobileTrialWidth.viewportWidth, 'channel trial creates mobile body overflow')
        await page.screenshot({ path: join(artifactDir, 'channel-trial-mobile.png'), fullPage: true })

        console.log(JSON.stringify({ status: 'ok', channelModal, mobile, mobileTrialWidth, pagination: { page: 3, limit: 750 }, singleCheckInPlace: true, regexTrial: true, importedRows: 2000, artifacts: artifactDir }, null, 2))
    } finally {
        if (browser) await browser.close()
        server.kill('SIGTERM')
    }
}

run().catch(error => {
    console.error(error)
    process.exitCode = 1
})
