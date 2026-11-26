// Check that a page drew its diagrams, on a machine with no WebKit check (snap.swift).
// Called by page.sh:
//
//   node drawn.mjs <page.html>
//
// Opens the page in a headless Chrome that is already on the machine and reads what the
// page wrote down about itself (page.js). It sees a diagram that does not draw; it does
// not check the layout and takes no picture.
//
// Prints "ok" or "FAIL" for each diagram and a "warn" for each thing the page noticed.
// Exits 0 when every diagram drew, 3 when one did not, 4 when there is no Chrome to ask.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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
const browser = BROWSERS.find(path => path && existsSync(path))

if (!browser) {
  console.log('warn  no swiftc and no Chrome: nothing checked that the diagrams draw; open the page and look')
  process.exit(4)
}

const flags = ['--headless', '--disable-gpu', '--no-sandbox', '--window-size=1360,1000', '--virtual-time-budget=60000', '--dump-dom']
let page = ''
try {
  page = execFileSync(browser, [...flags, pathToFileURL(process.argv[2]).href], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }).toString()
} catch {
  page = ''
}

const written = page.match(/<html[^>]*\sdata-wtf="([^"]*)"/)

if (!written) {
  console.log('FAIL  --  the page never finished drawing its diagrams')
  process.exit(3)
}

const text = written[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const { diagrams, warnings } = JSON.parse(text)

for (const diagram of diagrams) {
  console.log(`${diagram.why ? 'FAIL ' : 'ok   '} ${diagram.number}  ${diagram.first}`)
  diagram.why.split('\n').filter(Boolean).slice(0, 8).forEach(line => console.log(`      ${line}`))
}
warnings.forEach(warning => console.log(`warn  ${warning}`))
console.log('warn  checked in Chrome only: no layout check and no picture (they need swiftc, on macOS)')
process.exit(diagrams.some(diagram => diagram.why) ? 3 : 0)
