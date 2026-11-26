// Drive a real Chrome from the tests, with nothing to install: Chrome is started headless
// and spoken to over its DevTools protocol through node's own WebSocket (node 22+).
//
//   const chrome = await launch()
//   const page = await chrome.open('/path/to/page.html')
//   await page.run('document.title')          run script in the page, get its value
//   await page.hover('.card') / page.click()  a real mouse, at the middle of the element
//   await page.picture('/path/out.png')       the whole page
//   page.errors                               every error the page threw or logged
//   await chrome.close()

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BROWSERS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

export const WIDTH = 1360

export function findChrome() {
  return BROWSERS.find(path => path && existsSync(path)) || null
}

export async function launch() {
  const path = findChrome()

  if (!path) {
    throw new Error('no Chrome found: install one or set CHROME_PATH')
  }

  const profile = mkdtempSync(join(tmpdir(), 'skills-chrome-'))
  const flags = ['--headless=new', '--remote-debugging-port=0', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`, `--window-size=${WIDTH},1000`, 'about:blank']
  const chrome = spawn(path, flags, { stdio: ['ignore', 'ignore', 'pipe'] })
  const address = await new Promise((resolve, reject) => {
    let said = ''
    const late = setTimeout(() => reject(new Error(`Chrome did not start:\n${said}`)), 30000)

    chrome.stderr.on('data', chunk => {
      said += chunk
      const found = said.match(/DevTools listening on (ws:\/\/\S+)/)

      if (found) {
        clearTimeout(late)
        resolve(found[1])
      }
    })
    chrome.on('exit', code => reject(new Error(`Chrome exited with ${code}:\n${said}`)))
  })

  const socket = new WebSocket(address)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('could not reach Chrome'))
  })

  const waiting = new Map()
  const listeners = new Map()
  let last = 0

  socket.onmessage = event => {
    const message = JSON.parse(event.data)

    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id)

      waiting.delete(message.id)
      message.error ? reject(new Error(message.error.message)) : resolve(message.result)
    } else if (message.method) {
      listeners.get(message.sessionId)?.(message.method, message.params)
    }
  }

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      last += 1
      waiting.set(last, { resolve, reject })
      socket.send(JSON.stringify({ id: last, method, params, sessionId }))
    })

  async function open(file) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const tell = (method, params) => send(method, params, sessionId)
    const errors = []

    listeners.set(sessionId, (method, params) => {
      if (method === 'Runtime.exceptionThrown') {
        errors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text)
      }
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        errors.push(params.args.map(arg => arg.value ?? arg.description).join(' '))
      }
    })
    await tell('Runtime.enable')
    await tell('Page.enable')
    await tell('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1000, deviceScaleFactor: 1, mobile: false })

    async function run(script) {
      const { result, exceptionDetails } = await tell('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true })

      if (exceptionDetails) {
        throw new Error(exceptionDetails.exception?.description || exceptionDetails.text)
      }

      return result.value
    }

    async function until(script, what, limit = 60000) {
      const end = Date.now() + limit

      while (!(await run(script))) {
        if (Date.now() > end) {
          throw new Error(`waited ${limit / 1000} s and it never happened: ${what}`)
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    // The middle of an element, after it is scrolled into view.
    async function middle(selector) {
      const at = await run(`(() => {
        const part = document.querySelector(${JSON.stringify(selector)})
        if (!part) return null
        part.scrollIntoView({ block: 'center' })
        const box = part.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      })()`)

      if (!at) {
        throw new Error(`nothing matches ${selector}`)
      }

      return at
    }

    async function hover(selector) {
      const { x, y } = await middle(selector)

      await tell('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    }

    async function click(selector) {
      const { x, y } = await middle(selector)

      await tell('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await tell('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await tell('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    }

    async function press(key) {
      await tell('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
      await tell('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
    }

    async function picture(out) {
      const { data } = await tell('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })

      writeFileSync(out, Buffer.from(data, 'base64'))
    }

    await tell('Page.navigate', { url: pathToFileURL(file).href })
    await until('document.readyState === "complete"', `${file} loads`)

    return { run, until, hover, click, press, picture, errors }
  }

  async function close() {
    socket.close()
    chrome.removeAllListeners('exit')
    chrome.kill()
    await new Promise(resolve => chrome.on('exit', resolve))
    // Chrome's helpers can still be writing as it goes; the folder is in tmp, so a miss is fine.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch {}
  }

  return { open, close }
}
