import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectDir = dirname(scriptDir)
const nextBin = join(projectDir, 'node_modules', '.bin', 'next')
const routePath = '/dev/configuration-menu-overflow-regression'

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

async function collectPageDebug(page) {
    return page.evaluate(() => ({
        url: window.location.href,
        bodyText: document.body.innerText.slice(0, 1200),
        activeElement: document.activeElement?.outerHTML,
    }))
}

function assertMenuMetrics(metrics, label) {
    const assertions = [
        [metrics.className.includes('dropdown-scrollbar'), `${label} should use the styled scrollbar class`],
        [metrics.overflowY === 'auto', `${label} should use overflow-y:auto, received ${metrics.overflowY}`],
        [metrics.scrollHeight > metrics.clientHeight, `${label} should be scrollable with many candidates`],
        [metrics.clientHeight <= 421, `${label} height should be capped, received ${metrics.clientHeight}`],
        [metrics.top >= 0, `${label} should stay inside the top viewport edge, received top=${metrics.top}`],
        [
            metrics.bottom <= metrics.viewportHeight,
            `${label} should stay inside the bottom viewport edge, received bottom=${metrics.bottom}, viewport=${metrics.viewportHeight}`,
        ],
    ]

    for (const [passed, message] of assertions) {
        if (!passed) {
            throw new Error(message)
        }
    }
}

async function getElementMetrics(page, selector) {
    return page.$eval(selector, (element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)

        return {
            className: element.className,
            maxHeight: style.maxHeight,
            overflowY: style.overflowY,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            top: rect.top,
            bottom: rect.bottom,
            viewportHeight: window.innerHeight,
        }
    })
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
    let page

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

        page = await browser.newPage()
        await page.setViewport({ width: 812, height: 650, deviceScaleFactor: 1 })
        await page.goto(`${baseUrl}${routePath}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        })

        await page.waitForSelector('[data-testid="configuration-menu-overflow-regression"][data-ready="true"]', { timeout: 60_000 })

        await page.click('[data-testid="overflow-select-trigger"]')
        await page.waitForSelector('[data-testid="overflow-select-content"] [data-slot="select-viewport"]', { visible: true })

        const selectMetrics = await getElementMetrics(page, '[data-testid="overflow-select-content"] [data-slot="select-viewport"]')
        if (!selectMetrics.className.includes('--radix-select-content-available-height')) {
            throw new Error(`select viewport should respect Radix available height, received ${selectMetrics.className}`)
        }
        assertMenuMetrics(selectMetrics, 'select menu')

        await page.$eval('[data-testid="overflow-select-content"] [data-slot="select-viewport"]', (element) => {
            element.scrollTop = element.scrollHeight
        })
        await page.click('[data-testid="overflow-select-item-option_36"]')
        await page.waitForFunction(
            () => document.querySelector('[data-testid="overflow-select-output"]')?.textContent?.includes('条件选项 36'),
            { timeout: 10_000 }
        )

        await page.click('[data-testid="overflow-dropdown-trigger"]')
        await page.waitForSelector('[data-testid="overflow-dropdown-content"]', { visible: true })

        const dropdownMetrics = await getElementMetrics(page, '[data-testid="overflow-dropdown-content"]')
        if (!dropdownMetrics.className.includes('--radix-dropdown-menu-content-available-height')) {
            throw new Error(`dropdown menu should respect Radix available height, received ${dropdownMetrics.className}`)
        }
        assertMenuMetrics(dropdownMetrics, 'dropdown menu')

        await page.$eval('[data-testid="overflow-dropdown-content"]', (element) => {
            element.scrollTop = element.scrollHeight
        })
        await page.click('[data-testid="overflow-dropdown-item-option_36"]')
        await page.waitForFunction(
            () => document.querySelector('[data-testid="overflow-dropdown-output"]')?.textContent?.includes('条件选项 36'),
            { timeout: 10_000 }
        )

        await page.click('input[placeholder="选择字段"]')
        await page.waitForSelector('[data-testid="field-selector-suggestions"]', { visible: true })

        const fieldMetrics = await getElementMetrics(page, '[data-testid="field-selector-suggestions"]')
        assertMenuMetrics(fieldMetrics, 'field suggestion menu')

        await page.$eval('[data-testid="field-selector-suggestions"]', (element) => {
            element.scrollTop = element.scrollHeight
        })
        await page.evaluate(() => {
            const option = Array.from(document.querySelectorAll('[data-testid="field-selector-suggestions"] button'))
                .find((button) => button.textContent?.includes('field_36'))
            if (!(option instanceof HTMLButtonElement)) {
                throw new Error('Unable to find field_36 option')
            }
            option.click()
        })
        await page.waitForFunction(
            () => document.querySelector('[data-testid="overflow-field-output"]')?.textContent?.includes('field_36'),
            { timeout: 10_000 }
        )

        console.log('Configuration menu overflow regression passed.')
    } catch (error) {
        console.error(output.join(''))
        if (page) {
            console.error(JSON.stringify(await collectPageDebug(page), null, 2))
        }
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
