import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectDir = dirname(scriptDir)
const nextBin = join(projectDir, 'node_modules', '.bin', 'next')
const routePath = '/dev/action-dropdown-regression'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

            const { port } = address
            server.close(() => resolve(port))
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
            if (response.status < 500) {
                return
            }
        } catch (error) {
            lastError = error
        }

        await delay(500)
    }

    throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'no response'}`)
}

async function collectPageDebug(page) {
    return page.evaluate(() => ({
        url: window.location.href,
        buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
            testId: button.getAttribute('data-testid'),
            text: button.innerText.trim(),
            disabled: button.hasAttribute('disabled'),
            rect: (() => {
                const rect = button.getBoundingClientRect()
                return {
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                }
            })(),
        })),
        bodyText: document.body.innerText.slice(0, 1200),
    }))
}

async function waitForMenu(page) {
    try {
        await page.waitForSelector('[data-testid="add-action-menu-scroll"]', { visible: true })
    } catch (error) {
        console.error(JSON.stringify(await collectPageDebug(page), null, 2))
        throw error
    }
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
    ].find((candidate) => candidate && existsSync(candidate))
}

async function run() {
    const port = await getFreePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const server = spawn(nextBin, ['dev', '--hostname', '127.0.0.1', '--port', String(port)], {
        cwd: projectDir,
        env: {
            ...process.env,
            NEXT_TELEMETRY_DISABLED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })

    const output = []
    server.stdout.on('data', (chunk) => output.push(chunk.toString()))
    server.stderr.on('data', (chunk) => output.push(chunk.toString()))

    let browser

    try {
        await waitForServer(`${baseUrl}${routePath}`, server)

        const executablePath = resolveChromeExecutable()
        if (!executablePath) {
            throw new Error('Unable to find a Chrome executable for Puppeteer.')
        }

        browser = await puppeteer.launch({
            headless: true,
            executablePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })

        const page = await browser.newPage()
        await page.setViewport({ width: 812, height: 650, deviceScaleFactor: 1 })
        await page.evaluateOnNewDocument(() => {
            window.localStorage.clear()
            window.sessionStorage.clear()

            class QuietWebSocket {
                constructor() {
                    setTimeout(() => {
                        this.onerror?.(new Event('error'))
                        this.onclose?.(new CloseEvent('close', { code: 1000 }))
                    }, 0)
                }

                close() {
                    this.onclose?.(new CloseEvent('close', { code: 1000 }))
                }

                send() {}
                addEventListener() {}
                removeEventListener() {}
            }

            Object.defineProperty(window, 'WebSocket', {
                configurable: true,
                value: QuietWebSocket,
            })
        })

        await page.goto(`${baseUrl}${routePath}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        })

        await page.waitForSelector('[data-testid="action-dropdown-regression"][data-ready="true"]', { timeout: 60_000 })
        await page.click('[data-testid="add-action-start"]')
        await waitForMenu(page)

        const metrics = await page.$eval('[data-testid="add-action-menu-scroll"]', (element) => {
            const rect = element.getBoundingClientRect()
            const style = window.getComputedStyle(element)

            return {
                className: element.className,
                maxHeight: element.style.maxHeight,
                overflowY: style.overflowY,
                clientHeight: element.clientHeight,
                scrollHeight: element.scrollHeight,
                top: rect.top,
                bottom: rect.bottom,
                viewportHeight: window.innerHeight,
            }
        })

        const assertions = [
            [metrics.className.includes('dropdown-scrollbar'), 'scroll container should use the styled scrollbar class'],
            [metrics.overflowY === 'auto', `scroll container should use overflow-y:auto, received ${metrics.overflowY}`],
            [metrics.maxHeight.includes('420px'), `scroll container should cap max height at 420px, received ${metrics.maxHeight}`],
            [
                metrics.maxHeight.includes('--radix-dropdown-menu-content-available-height'),
                `scroll container should respect Radix available height, received ${metrics.maxHeight}`,
            ],
            [metrics.scrollHeight > metrics.clientHeight, 'menu should have scrollable overflow with many actions'],
            [metrics.clientHeight <= 421, `menu client height should be capped, received ${metrics.clientHeight}`],
            [metrics.top >= 0, `menu should stay inside the top viewport edge, received top=${metrics.top}`],
            [
                metrics.bottom <= metrics.viewportHeight,
                `menu should stay inside the bottom viewport edge, received bottom=${metrics.bottom}, viewport=${metrics.viewportHeight}`,
            ],
        ]

        for (const [passed, message] of assertions) {
            if (!passed) {
                throw new Error(message)
            }
        }

        await page.click('[data-testid="add-action-plugin-regression_action_01"]')
        await page.waitForFunction(() => document.body.innerText.includes('回归动作 01'), { timeout: 10_000 })

        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
        await page.waitForSelector('[data-testid="action-dropdown-regression"][data-ready="true"]', { timeout: 60_000 })
        await page.click('[data-testid="add-action-start"]')
        await waitForMenu(page)
        await page.$eval('[data-testid="add-action-menu-scroll"]', (element) => {
            element.scrollTop = element.scrollHeight
        })
        await page.waitForFunction(() => {
            const element = document.querySelector('[data-testid="add-action-menu-scroll"]')
            return Boolean(element && element.scrollTop > 0)
        })
        await page.click('[data-testid="add-action-plugin-regression_action_24"]')
        await page.waitForFunction(() => document.body.innerText.includes('回归动作 24'), { timeout: 10_000 })

        console.log('Action dropdown scroll regression passed.')
    } catch (error) {
        console.error(output.join(''))
        throw error
    } finally {
        if (browser) {
            await browser.close()
        }

        if (server.exitCode === null) {
            server.kill('SIGTERM')
            await delay(500)
        }
    }
}

run().catch((error) => {
    console.error(error)
    process.exit(1)
})
