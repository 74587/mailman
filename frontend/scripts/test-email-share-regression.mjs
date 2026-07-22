import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)))
const nextBin = join(projectDir, 'node_modules', '.bin', 'next')
const artifactDir = process.env.EMAIL_SHARE_QA_ARTIFACT_DIR || '/tmp/mailman-email-share-qa'
const routePath = '/dev/email-share-regression'

function assert(condition, message) {
    if (!condition) throw new Error(message)
}

async function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (!address || typeof address === 'string') return server.close(() => reject(new Error('Unable to allocate port')))
            server.close(() => resolve(address.port))
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
        await new Promise(resolve => setTimeout(resolve, 300))
    }
    throw new Error('Timed out waiting for Next dev server')
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

async function run() {
    const port = await getFreePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const server = spawn(nextBin, ['dev', '--hostname', '127.0.0.1', '--port', String(port)], {
        cwd: projectDir,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const serverOutput = []
    server.stdout.on('data', chunk => serverOutput.push(chunk.toString()))
    server.stderr.on('data', chunk => serverOutput.push(chunk.toString()))
    let browser
    try {
        await waitForServer(`${baseUrl}${routePath}`, server)
        mkdirSync(artifactDir, { recursive: true })
        browser = await puppeteer.launch({ headless: 'new', executablePath: resolveChromeExecutable(), args: ['--no-sandbox', '--disable-setuid-sandbox'] })
        const page = await browser.newPage()
        await page.setViewport({ width: 1100, height: 820, deviceScaleFactor: 1 })
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    writeText: async value => { window.__copiedShareLink = value },
                    readText: async () => window.__copiedShareLink || '',
                },
            })
        })
        const shareRequests = []
        await page.setRequestInterception(true)
        page.on('request', request => {
            const url = new URL(request.url())
            if (request.method() === 'OPTIONS' && url.pathname.endsWith('/api/emails/42/share-links')) {
                request.respond({
                    status: 204,
                    headers: {
                        'access-control-allow-origin': '*',
                        'access-control-allow-headers': '*',
                        'access-control-allow-methods': 'POST, OPTIONS',
                    },
                })
                return
            }
            if (request.method() === 'POST' && url.pathname.endsWith('/api/emails/42/share-links')) {
                shareRequests.push(JSON.parse(request.postData() || '{}'))
                request.respond({
                    status: 201,
                    contentType: 'application/json',
                    headers: { 'access-control-allow-origin': '*' },
                    body: JSON.stringify({
                        token: 'secure_test_token_abcdefghijklmnopqrstuvwxyz',
                        emailId: 42,
                        accountId: 7,
                        direction: 'received',
                        expiresAt: '2026-07-29T08:00:00Z',
                    }),
                })
                return
            }
            request.continue()
        })

        await page.goto(`${baseUrl}${routePath}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await page.waitForSelector('[data-qa-ready="true"]')
        await page.waitForSelector('[data-email-id="42"]')
        await page.click('[data-email-id="42"]', { button: 'right' })
        await new Promise(resolve => setTimeout(resolve, 300))
        const contextMenuState = await page.evaluate(() => ({
            selected: document.querySelector('[data-email-id="42"]')?.className.includes('border-blue-500'),
            menus: document.querySelectorAll('[role="menu"]').length,
            text: document.body.innerText.slice(-600),
        }))
        assert(contextMenuState.selected, `right-click did not select email: ${JSON.stringify(contextMenuState)}`)
        assert(contextMenuState.menus > 0, `right-click did not open actions: ${JSON.stringify(contextMenuState)}`)
        await page.waitForFunction(() => document.querySelector('[role="menu"]')?.textContent?.includes('分享邮件'), { timeout: 10_000 })
        const selectedAfterRightClick = await page.$eval('[data-email-id="42"]', element => element.className.includes('border-blue-500'))
        assert(selectedAfterRightClick, 'right-click should select the email before opening actions')

        await page.evaluate(() => {
            const button = Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent?.includes('分享邮件'))
            if (!(button instanceof HTMLElement)) throw new Error('Share action not found')
            button.click()
        })
        await page.waitForSelector('[role="dialog"]')
        await page.waitForFunction(() => document.querySelector('[role="dialog"] input')?.value?.includes('mailShare='))
        assert(shareRequests.length === 1 && shareRequests[0].expiresInDays === 7, `unexpected share request: ${JSON.stringify(shareRequests)}`)
        const link = await page.$eval('[role="dialog"] input', element => element.value)
        const parsed = new URL(link)
        assert(parsed.pathname === '/main', `share link should open /main, received ${parsed.pathname}`)
        assert(parsed.searchParams.get('mailShare') === 'secure_test_token_abcdefghijklmnopqrstuvwxyz', 'share token was not encoded into the deep link')
        assert(!link.includes('accountId=') && !link.includes('emailId='), 'share link must not expose raw database IDs')

        await page.evaluate(() => {
            const button = Array.from(document.querySelectorAll('[role="dialog"] button')).find(item => item.textContent?.trim() === '复制')
            if (!(button instanceof HTMLButtonElement)) throw new Error('Copy action not found')
            button.click()
        })
        await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('已复制'))
        const copied = await page.evaluate(() => navigator.clipboard.readText())
        assert(copied === link, 'one-click copy should copy the exact share link')
        await page.screenshot({ path: join(artifactDir, 'email-share-dialog.png'), fullPage: true })

        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
        const mobileMetrics = await page.$eval('[role="dialog"]', element => {
            const rect = element.getBoundingClientRect()
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, bodyWidth: document.body.scrollWidth }
        })
        assert(mobileMetrics.left >= 0 && mobileMetrics.right <= mobileMetrics.viewportWidth, `share dialog overflows horizontally: ${JSON.stringify(mobileMetrics)}`)
        assert(mobileMetrics.top >= 0 && mobileMetrics.bottom <= mobileMetrics.viewportHeight, `share dialog overflows vertically: ${JSON.stringify(mobileMetrics)}`)
        assert(mobileMetrics.bodyWidth <= mobileMetrics.viewportWidth, `share dialog creates body overflow: ${JSON.stringify(mobileMetrics)}`)
        await page.screenshot({ path: join(artifactDir, 'email-share-dialog-mobile.png'), fullPage: true })

        console.log(JSON.stringify({ status: 'ok', shareRequests, link, mobileMetrics, artifacts: artifactDir }, null, 2))
    } finally {
        if (browser) await browser.close()
        server.kill('SIGTERM')
        await new Promise(resolve => server.once('exit', resolve))
        if (server.exitCode && server.exitCode !== 0) console.error(serverOutput.join(''))
    }
}

run().catch(error => {
    console.error(error.stack || error)
    process.exitCode = 1
})
