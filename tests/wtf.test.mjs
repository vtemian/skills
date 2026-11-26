// End to end tests of the wtf skill: markdown in, a page out, and the page opened in a
// real Chrome to see that its diagrams are drawn, visible and usable.
//
//   node --test tests/*.test.mjs
//
// Every page is built by scripts/page.sh, the command the skill runs. The pages and a
// picture of each are left in tests/out/ to look at when a test fails.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { launch } from './browser.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPTS = join(HERE, '..', 'skills', 'wtf', 'scripts')
const OUT = join(HERE, 'out')
const WEBKIT = process.platform === 'darwin' && spawnSync('sh', ['-c', 'command -v swiftc']).status === 0

// Build a fixture the way the skill does. Returns what page.sh printed and where the page is.
function build(name, env = {}) {
  const doc = join(OUT, `${name}.md`)

  copyFileSync(join(HERE, 'fixtures', `${name}.md`), doc)
  const ran = spawnSync(join(SCRIPTS, 'page.sh'), [doc], { encoding: 'utf8', env: { ...process.env, NO_OPEN: '1', ...env } })

  return { status: ran.status, printed: ran.stdout + ran.stderr, page: join(OUT, `${name}.html`), picture: join(OUT, `${name}.png`) }
}

// What a reader would see of every figure, measured in the page.
const SEEN = `(() => {
  const shown = part => {
    const box = part.getBoundingClientRect()
    const style = getComputedStyle(part)
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0
  }
  // A straight arrow is a box with no width or no height, so an arrow is seen by its length.
  const drawn = arrow => {
    const style = getComputedStyle(arrow)
    return arrow.getTotalLength() > 5 && style.visibility !== 'hidden' && style.display !== 'none' && style.stroke !== 'none' && Number(style.opacity) > 0
  }
  const onTop = part => {
    part.scrollIntoView({ block: 'center' })
    const box = part.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return hit !== null && (part === hit || part.contains(hit))
  }
  return [...document.querySelectorAll('figure.diagram')].map(figure => {
    const svg = figure.querySelector('.stage svg')
    const size = svg ? svg.getBoundingClientRect() : { width: 0, height: 0 }
    return {
      number: figure.dataset.number,
      broken: figure.classList.contains('broken'),
      said: figure.classList.contains('broken') ? figure.querySelector('.stage p').textContent : '',
      width: Math.round(size.width),
      height: Math.round(size.height),
      shown: svg ? shown(svg) : false,
      placed: figure.querySelector('.stage.placed') !== null,
      arrows: svg ? [...svg.querySelectorAll('path.flowchart-link, .messageLine0, .messageLine1')].filter(drawn).length : 0,
      labels: svg ? [...svg.querySelectorAll('span.edgeLabel, text.messageText')].map(label => label.textContent.trim()).filter(Boolean) : [],
      badges: svg ? svg.querySelectorAll('g.badge').length : 0,
      cards: [...figure.querySelectorAll('.cards .card')].map(card => {
        const top = onTop(card)
        const box = card.getBoundingClientRect()
        const under = svg.querySelector('g.node[data-box="' + card.dataset.box + '"] > rect')
        const below = under ? under.getBoundingClientRect() : null
        return {
          id: card.dataset.box,
          title: card.querySelector('.title').textContent,
          icon: card.querySelector('.tile svg') !== null,
          chip: card.querySelector('.chip')?.textContent || '',
          shown: shown(card) && shown(card.querySelector('.title')),
          onTop: top,
          cut: card.querySelector('.title').scrollWidth > card.querySelector('.title').clientWidth + 1,
          left: box.left + scrollX, top: box.top + scrollY, right: box.right + scrollX, bottom: box.bottom + scrollY,
          off: below ? Math.max(Math.abs(box.left - below.left), Math.abs(box.top - below.top), Math.abs(box.width - below.width), Math.abs(box.height - below.height)) : null,
        }
      }),
      notes: [...figure.querySelectorAll('.notes li')].map(note => note.dataset.box),
    }
  })
})()`

function overlap(one, two) {
  return Math.max(0, Math.min(one.right, two.right) - Math.max(one.left, two.left)) * Math.max(0, Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top))
}

let chrome

before(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  chrome = await launch()
})

after(async () => {
  await chrome?.close()
})

describe('a good explanation', () => {
  let built
  let page
  let figures

  before(async () => {
    built = build('good')
    page = await chrome.open(built.page)
    await page.until('window.wtf && window.wtf.done', 'the page finishes drawing')
    figures = await page.run(SEEN)
    await page.picture(join(OUT, 'good.chrome.png'))
  })

  test('page.sh builds it and says every diagram drew', () => {
    assert.equal(built.status, 0, built.printed)
    assert.match(built.printed, /^page {2}.*good\.html$/m)
    assert.match(built.printed, /^ok {4}01 {2}flowchart TD$/m)
    assert.match(built.printed, /^ok {4}02 {2}sequenceDiagram$/m)
    assert.doesNotMatch(built.printed, /^FAIL/m)
    assert.doesNotMatch(built.printed, /^warn {2}(diagram|section)/m, 'a good page has nothing to warn about')
  })

  test('the WebKit check passes and saves a picture of the page', { skip: !WEBKIT && 'needs macOS with swiftc' }, () => {
    assert.match(built.printed, /^look {2}layout ok$/m)
    assert.ok(existsSync(built.picture), 'the picture is saved')
    assert.ok(statSync(built.picture).size > 50000, 'the picture is not an empty page')
  })

  test('without WebKit a headless Chrome checks that the diagrams draw', () => {
    const ran = spawnSync('node', [join(SCRIPTS, 'drawn.mjs'), built.page], { encoding: 'utf8' })

    assert.equal(ran.status, 0, ran.stdout)
    assert.match(ran.stdout, /^ok {4}01 {2}flowchart TD$/m)
    assert.match(ran.stdout, /^ok {4}02 {2}sequenceDiagram$/m)
  })

  test('the page is one file that loads nothing from the network', async () => {
    const outside = await page.run('[...document.querySelectorAll("script[src], link[href], img[src], iframe, object, embed")].map(part => part.outerHTML.slice(0, 80))')
    const fetched = await page.run('performance.getEntriesByType("resource").map(entry => entry.name)')

    assert.deepEqual(outside, [], 'nothing on the page points at another file or site')
    assert.deepEqual(fetched, [], 'the page fetched nothing while it drew')
    assert.ok(statSync(built.page).size > 1000000, 'Mermaid is inside the page')
  })

  test('the text of the explanation is on the page', async () => {
    const text = await page.run('document.querySelector("main").innerText')

    assert.equal(await page.run('document.title'), 'How a request becomes a job')
    assert.match(text, /How a request becomes a job/)
    assert.match(text, /The path of one request/)
    assert.match(text, /The api never waits for the worker\./, 'the note in the margin')
    assert.match(text, /The retry count was read from the code/, 'the "not verified" note')
    assert.equal(await page.run('document.querySelectorAll("aside.margin").length'), 2)
    assert.equal(await page.run('document.querySelectorAll("table tr").length'), 3)
    assert.equal(await page.run('document.querySelectorAll("code.ref").length'), 2, 'file:line pointers are marked')
  })

  test('the page reports no error while it draws', () => {
    assert.deepEqual(page.errors, [])
  })

  test('both diagrams are drawn and visible', () => {
    assert.equal(figures.length, 2)
    for (const figure of figures) {
      assert.equal(figure.broken, false, `diagram ${figure.number} drew`)
      assert.ok(figure.shown, `diagram ${figure.number} is visible`)
      assert.ok(figure.width > 300 && figure.height > 100, `diagram ${figure.number} has a real size, got ${figure.width}x${figure.height}`)
    }
  })

  test('the flowchart has its arrows and their labels', () => {
    const [flow] = figures

    assert.equal(flow.arrows, 5, 'five arrows are drawn')
    assert.deepEqual(flow.labels.sort(), ['enqueue', 'write'])
  })

  test('every box of the flowchart is a card, visible, on its own box', () => {
    const [flow] = figures

    assert.ok(flow.placed, 'the cards were placed')
    assert.deepEqual(flow.cards.map(card => card.id).sort(), ['api', 'db', 'done', 'queue', 'user', 'worker'])
    assert.equal(flow.cards.find(card => card.id === 'api').title, 'Api')
    for (const card of flow.cards) {
      assert.ok(card.shown, `card ${card.id} is visible`)
      assert.ok(card.onTop, `card ${card.id} is not covered by anything`)
      assert.ok(card.icon, `card ${card.id} has its icon`)
      assert.equal(card.cut, false, `the title of card ${card.id} is not cut off`)
      assert.ok(card.off !== null && card.off <= 1.5, `card ${card.id} sits on the box Mermaid drew for it (off by ${card.off}px)`)
    }
    flow.cards.forEach((card, at) => {
      for (const other of flow.cards.slice(at + 1)) {
        assert.equal(overlap(card, other), 0, `cards ${card.id} and ${other.id} do not overlap`)
      }
    })
  })

  test('the notes are numbered on their cards', () => {
    const [flow] = figures
    const chips = Object.fromEntries(flow.cards.map(card => [card.id, card.chip]))

    assert.deepEqual(flow.notes, ['user', 'api', 'queue', 'worker', 'db'])
    assert.deepEqual(chips, { user: '1', api: '2', queue: '3', worker: '4', db: '5', done: '' })
  })

  test('the sequence diagram has its messages and a badge for each note', () => {
    const [, sequence] = figures

    assert.equal(sequence.arrows, 3)
    assert.deepEqual(sequence.labels, ['put job', 'take job', 'result is ready'])
    assert.equal(sequence.cards.length, 0, 'a sequence diagram is not drawn as cards')
    assert.equal(sequence.badges, 2, 'one numbered badge per note')
  })

  test('pointing at a card lights it and fades the rest', async () => {
    const lit = '[...document.querySelectorAll("#figure-01 .card.on")].map(card => card.dataset.box)'

    await page.hover('#figure-01 .card[data-box="queue"]')
    assert.deepEqual(await page.run(lit), ['queue'])
    assert.equal(await page.run('document.querySelector("#figure-01").classList.contains("focused")'), true)
    assert.deepEqual(await page.run('[...document.querySelectorAll("#figure-01 .card.near")].map(card => card.dataset.box).sort()'), ['api', 'worker'], 'its neighbours stay')
    assert.equal(await page.run('document.querySelectorAll("#figure-01 path.flowchart-link.on").length'), 2, 'its two arrows are lit')
    assert.equal(await page.run('document.querySelector(\'#figure-01 .notes li[data-box="queue"]\').classList.contains("on")'), true, 'and so is its note')
  })

  test('clicking a note keeps its card chosen, the arrows step on, Escape lets go', async () => {
    const chosen = '[...document.querySelectorAll("#figure-01 .card.on")].map(card => card.dataset.box)'
    const at = 'document.querySelector("#figure-01 .walk .at").textContent'

    await page.click('#figure-01 .notes li[data-box="api"]')
    await page.hover('h1')
    assert.deepEqual(await page.run(chosen), ['api'], 'still chosen after the mouse left')
    assert.equal(await page.run(at), '2 of 5')

    await page.click('#figure-01 .walk button[data-step="1"]')
    await page.hover('h1')
    assert.deepEqual(await page.run(chosen), ['queue'])
    assert.equal(await page.run(at), '3 of 5')

    await page.run('document.querySelector(\'#figure-01 .notes li[data-box="queue"]\').focus()')
    await page.press('Escape')
    assert.deepEqual(await page.run(chosen), [])
    assert.equal(await page.run('document.querySelector("#figure-01").classList.contains("focused")'), false)
  })

  test('the cards stay on their boxes when the window gets narrow', async () => {
    const off = `Math.max(...[...document.querySelectorAll('#figure-01 .card')].map(card => {
      const box = card.getBoundingClientRect()
      const below = document.querySelector('#figure-01 g.node[data-box="' + card.dataset.box + '"] > rect').getBoundingClientRect()
      return Math.max(Math.abs(box.left - below.left), Math.abs(box.top - below.top))
    }))`

    await page.run('document.querySelector("#figure-01 .canvas").style.width = "700px"')
    await page.until(`${off} <= 1.5`, 'the cards follow their boxes', 5000)
  })
})

describe('an explanation with a diagram that does not draw', () => {
  let built
  let page
  let figures

  before(async () => {
    built = build('broken')
    page = await chrome.open(built.page)
    await page.until('window.wtf && window.wtf.done', 'the page finishes drawing')
    figures = await page.run(SEEN)
    await page.picture(join(OUT, 'broken.chrome.png'))
  })

  test('page.sh fails, names the diagram and passes on what Mermaid said', () => {
    assert.equal(built.status, 3, built.printed)
    assert.match(built.printed, /^FAIL {2}01 {2}flowchart TD$/m)
    assert.match(built.printed, /Parse error on line 3/)
    assert.match(built.printed, /^ok {4}02 {2}flowchart LR$/m)
    assert.match(built.printed, /fix the failing blocks/)
  })

  test('the Chrome check fails the same way', () => {
    const ran = spawnSync('node', [join(SCRIPTS, 'drawn.mjs'), built.page], { encoding: 'utf8' })

    assert.equal(ran.status, 3, ran.stdout)
    assert.match(ran.stdout, /^FAIL {2}01 {2}flowchart TD$/m)
  })

  test('the page shows the error and the text in place of the drawing', async () => {
    const [bad] = figures

    assert.ok(bad.broken)
    assert.match(bad.said, /^This diagram did not draw: Parse error on line 3/)
    assert.match(await page.run('document.querySelector("#figure-01 .stage pre").innerText'), /worker --> --> nowhere/)
    assert.equal(await page.run('document.querySelectorAll("#figure-01 .stage svg").length'), 0, 'nothing half drawn is left')
  })

  test('the good diagram on the same page still draws', () => {
    const [, good] = figures

    assert.equal(good.broken, false)
    assert.ok(good.shown && good.placed)
    assert.equal(good.cards.length, 2)
    assert.ok(good.cards.every(card => card.shown && card.off <= 1.5))
  })
})

describe('an explanation the author should fix', () => {
  let built

  before(() => {
    built = build('warnings')
  })

  test('page.sh builds it and warns about each thing', () => {
    assert.equal(built.status, 0, built.printed)
    assert.match(built.printed, /^warn {2}diagram 01: `:::notakind` is not a kind/m)
    assert.match(built.printed, /^warn {2}diagram 01: box `plain` has no kind/m)
    assert.match(built.printed, /^warn {2}diagram 01: the note for `ghost` matches no box id/m)
    assert.match(built.printed, /^warn {2}section "A section with only words" has no diagram/m)
  })
})

describe('an explanation with no diagram', () => {
  let built

  before(() => {
    built = build('words')
  })

  test('page.sh builds a small page without Mermaid in it', () => {
    assert.equal(built.status, 0, built.printed)
    assert.ok(statSync(built.page).size < 200000, 'Mermaid is only put in a page that has a diagram')
  })

  test('the page opens with no error', async () => {
    const page = await chrome.open(built.page)

    await page.until('window.wtf && window.wtf.done', 'the page finishes')
    assert.deepEqual(page.errors, [])
    assert.match(await page.run('document.querySelector("main").innerText'), /Only words here\./)
  })
})

describe('page.sh', () => {
  test('says how to call it when it gets no file', () => {
    const ran = spawnSync(join(SCRIPTS, 'page.sh'), [], { encoding: 'utf8' })

    assert.equal(ran.status, 2)
    assert.match(ran.stderr, /usage: page\.sh/)
  })
})

describe('look.sh', () => {
  test('lists the files, the docs and the last commits of a project', () => {
    const project = mkdtempSync(join(tmpdir(), 'skills-look-'))
    const git = (...args) => spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd: project })

    writeFileSync(join(project, 'README.md'), '# A project\n')
    writeFileSync(join(project, 'app.py'), 'print("hi")\n')
    git('init', '-q')
    git('add', '.')
    git('commit', '-q', '-m', 'first commit')
    writeFileSync(join(project, 'new.txt'), 'not added yet\n')

    const ran = spawnSync(join(SCRIPTS, 'look.sh'), [project], { encoding: 'utf8' })

    assert.equal(ran.status, 0)
    assert.match(ran.stdout, /== files\nREADME\.md\napp\.py\n== untracked\nnew\.txt\n/)
    assert.match(ran.stdout, /== docs\n.*README\.md/)
    assert.match(ran.stdout, /== recent commits\n\w+ first commit/)
    rmSync(project, { recursive: true, force: true })
  })

  test('never fails: not on a folder without git, not on a missing folder', () => {
    const plain = mkdtempSync(join(tmpdir(), 'skills-look-'))

    writeFileSync(join(plain, 'notes.txt'), 'x\n')
    const there = spawnSync(join(SCRIPTS, 'look.sh'), [plain], { encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(plain) } })
    const missing = spawnSync(join(SCRIPTS, 'look.sh'), [join(plain, 'nope')], { encoding: 'utf8' })

    assert.equal(there.status, 0)
    assert.match(there.stdout, /notes\.txt/)
    assert.match(there.stdout, /\(not a git repository\)/)
    assert.equal(missing.status, 0)
    assert.match(missing.stdout, /no such directory/)
    rmSync(plain, { recursive: true, force: true })
  })
})
