import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectDir = dirname(scriptDir)
const nextBin = join(projectDir, 'node_modules', '.bin', 'next')
const routePath = '/dev/plugin-config-form-regression'

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

async function setTextInput(page, labelText, value) {
    await page.waitForFunction((text) => {
        const labels = Array.from(document.querySelectorAll('label'))
        const label = labels.find((item) => item.textContent?.trim() === text)
        const container = label?.closest('.space-y-2') || label?.parentElement?.parentElement
        return container?.querySelector('input, textarea') || null
    }, {}, labelText)

    await page.evaluate(({ text, nextValue }) => {
        const labels = Array.from(document.querySelectorAll('label'))
        const label = labels.find((item) => item.textContent?.trim() === text)
        const container = label?.closest('.space-y-2') || label?.parentElement?.parentElement
        const element = container?.querySelector('input, textarea')
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
            throw new Error(`Unable to find input for ${text}`)
        }

        const prototype = element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
        setter?.call(element, nextValue)
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        element.focus()
    }, { text: labelText, nextValue: value })
}

async function readOutput(page, testId) {
    return page.$eval(`[data-testid="${testId}"]`, (element) => JSON.parse(element.textContent || '{}'))
}

async function debugOutput(page) {
    return page.evaluate(() => ({
        json: document.querySelector('[data-testid="json-schema-output"]')?.textContent,
        fields: document.querySelector('[data-testid="ui-field-schema-output"]')?.textContent,
        bodyText: document.body.innerText.slice(0, 1200),
    }))
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
        await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 1 })
        await page.goto(`${baseUrl}${routePath}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        })

        await page.waitForSelector('[data-testid="plugin-config-form-regression"][data-ready="true"]', { timeout: 60_000 })
        await page.waitForSelector('[data-testid="json-schema-form"] input')
        await page.waitForSelector('[data-testid="ui-field-schema-form"] input')

        await setTextInput(page, '标题', '自定义标题')
        await setTextInput(page, '重试次数', '5')
        await page.keyboard.press('Tab')
        try {
            await page.waitForFunction(() => {
                const output = document.querySelector('[data-testid="json-schema-output"]')
                const config = JSON.parse(output?.textContent || '{}')
                return config.title === '自定义标题' && config.retries === 5
            })
        } catch (error) {
            console.error(JSON.stringify(await debugOutput(page), null, 2))
            throw error
        }

        const jsonConfig = await readOutput(page, 'json-schema-output')
        if (jsonConfig.title !== '自定义标题' || jsonConfig.retries !== 5) {
            throw new Error(`JSON schema form did not update correctly: ${JSON.stringify(jsonConfig)}`)
        }

        await setTextInput(page, '标签', 'important')
        await page.keyboard.press('Enter')
        await setTextInput(page, '请求头', '{"Authorization":"Bearer token"}')
        await page.evaluate(() => {
            const active = document.activeElement
            if (active instanceof HTMLElement) {
                active.blur()
            }
        })
        try {
            await page.waitForFunction(() => {
                const output = document.querySelector('[data-testid="ui-field-schema-output"]')
                const config = JSON.parse(output?.textContent || '{}')
                return Array.isArray(config.tags) &&
                    config.tags[0] === 'important' &&
                    config.headers?.Authorization === 'Bearer token'
            })
        } catch (error) {
            console.error(JSON.stringify(await debugOutput(page), null, 2))
            throw error
        }

        const fieldsConfig = await readOutput(page, 'ui-field-schema-output')
        if (!Array.isArray(fieldsConfig.tags) || fieldsConfig.tags[0] !== 'important') {
            throw new Error(`UI fields array input did not update correctly: ${JSON.stringify(fieldsConfig)}`)
        }
        if (fieldsConfig.headers?.Authorization !== 'Bearer token') {
            throw new Error(`UI fields object input did not update correctly: ${JSON.stringify(fieldsConfig)}`)
        }

        const selectText = await page.$eval('[data-testid="ui-field-schema-form"]', (element) => element.innerText)
        if (!selectText.includes('日志级别') || !selectText.includes('信息')) {
            throw new Error('UI fields select field did not render its option label')
        }

        console.log('Plugin config form regression passed.')
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
