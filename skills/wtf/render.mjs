// Build one page from an explanation in markdown. Called by page.sh.
//
//   node render.mjs <explanation.md> <diagrams dir> <out.html> <path of mmdc>
//
// What the markdown may hold beyond plain markdown:
//   ```mermaid block            -> a figure, from <diagrams dir>/NN.svg
//   a list right after it whose -> numbered notes on that figure; each item starts
//   items start with `box id`      with the id of a box and gets a badge on that box
//   > [!NOTE] / [!IMPORTANT] /  -> a margin note: a side fact / easy to get wrong /
//     [!WARNING] blockquote        not verified
//
// marked is taken from the mermaid-cli install, so there is nothing else to install.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [doc, diagrams, out, mmdc] = process.argv.slice(2)
const here = dirname(fileURLToPath(import.meta.url))
const { marked } = createRequire(mmdc)('marked')

const KINDS = {
  NOTE: ['note', 'Note'],
  TIP: ['note', 'Note'],
  IMPORTANT: ['surprise', 'Easy to get wrong'],
  WARNING: ['gap', 'Not verified'],
  CAUTION: ['gap', 'Not verified'],
}

const WIDEST = 1300
const PROSE = 60
const words = text => text.split(/\s+/).filter(Boolean).length
const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const warnings = []
const tokens = marked.lexer(readFileSync(doc, 'utf8'))
const html = piece => ({ type: 'html', raw: piece, text: piece, pre: true })
const render = token => marked.parser(Object.assign([token], { links: tokens.links }))

function callout(token) {
  const inner = token.raw.replace(/^ {0,3}> ?/gm, '')
  const mark = inner.match(/^\s*\[!(\w+)\]\s*\n?/)
  const kind = mark && KINDS[mark[1].toUpperCase()]

  if (!kind) {
    return null
  }

  return `<aside class="margin ${kind[0]}"><span class="label">${kind[1]}</span>${marked.parse(inner.slice(mark[0].length))}</aside>`
}

function noteItems(token) {
  if (!token || token.type !== 'list') {
    return null
  }

  const items = token.items.map(item => item.text.match(/^`([^`]+)`\s*(?:[—–:-]\s*)?([\s\S]+)$/))

  return items.every(Boolean) ? items.map(found => ({ box: found[1], text: found[2] })) : null
}

const { kinds } = JSON.parse(readFileSync(join(here, 'icons.json'), 'utf8'))
const icon = kind =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${kinds[kind].body}</svg>`

function card(id, box, order) {
  const tile = box.kind ? `<span class="tile">${icon(box.kind)}</span>` : ''
  const detail = box.detail ? `<span class="detail">${escapeHtml(box.detail)}</span>` : ''
  const chip = order ? `<span class="chip">${order}</span>` : ''
  const family = box.kind ? kinds[box.kind].family : 'plain'

  return `<div class="card ${family}" data-box="${id}" tabindex="0">${tile}<span class="words"><span class="title">${escapeHtml(box.title)}</span>${detail}</span>${chip}</div>`
}

// The cards are plain HTML laid over the drawing (page.js puts each on its box).
// HTML inside the SVG itself is misplaced by WebKit, so the boxes in it stay empty.
function withBoxes(svg, boxes) {
  const node =
    /<g class="node ([^"]*" id="[^"]+"[^>]*>\s*<rect[^>]*?\/>\s*<g class="label"[^>]*>\s*<rect\/>)<foreignObject[^>]*>(?:(?!<\/foreignObject>)[\s\S])*?data-node="([^"]+)"(?:(?!<\/foreignObject>)[\s\S])*?<\/foreignObject>/g

  return svg.replace(node, (whole, head, id) => (boxes[id] ? `<g data-box="${id}" class="node carded ${head}` : whole))
}

function withEnds(svg, ids) {
  return svg.replace(/data-id="L_([^"]+)_\d+"/g, (whole, pair) => {
    const from = ids.find(id => pair.startsWith(`${id}_`) && ids.includes(pair.slice(id.length + 1)))

    return from ? `${whole} data-from="${from}" data-to="${pair.slice(from.length + 1)}"` : whole
  })
}

function target(svg, number, box) {
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(found => found[1])
  const safe = box.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wanted = new RegExp(`^diagram-${number}-(?:[A-Za-z]+-)?${safe}(?:-\\d+)?$`)
  const id = ids.find(candidate => wanted.test(candidate))

  if (id) {
    return `data-target="${id}"`
  }

  if (svg.includes(`name="${box}"`)) {
    return `data-actor="${escapeHtml(box)}"`
  }

  warnings.push(`diagram ${number}: the note for \`${box}\` matches no box id; it is listed without a badge`)

  return ''
}

function figure(number, notes) {
  const file = join(diagrams, `${number}.svg`)
  const record = join(diagrams, `${number}.json`)
  const { boxes = {}, unknown = [] } = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : {}
  const order = Object.fromEntries((notes || []).map((note, index) => [note.box, index + 1]))
  const plain = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const svg = withEnds(withBoxes(plain, boxes), Object.keys(boxes))
  const cards = Object.entries(boxes).map(([id, each]) => card(id, each, order[id])).join('')
  const rows = (notes || []).map((note, index) => {
    const box = boxes[note.box]
    const name = box ? `<b>${escapeHtml(box.title)}</b>` : ''
    const mark = box && box.kind ? `<span class="tile ${kinds[box.kind].family}">${icon(box.kind)}</span>` : ''

    return `<li ${target(svg, number, note.box)} data-box="${escapeHtml(note.box)}" tabindex="0"><span class="n">${index + 1}</span><span class="say">${mark}${name}<span>${marked.parseInline(note.text)}</span></span></li>`
  })
  const walk = rows.length > 1 ? `<div class="walk"><button type="button" data-step="-1" aria-label="Previous box">←</button><span class="at">Step through</span><button type="button" data-step="1" aria-label="Next box">→</button></div>` : ''
  const list = rows.length ? `<div class="side">${walk}<ol class="notes">${rows.join('')}</ol></div>` : ''
  const box = (svg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/) || []).slice(1).map(Number)
  const [width = 0, height = 0] = box
  const tall = rows.length && height > width * 0.9 ? ' tall' : ''

  unknown.forEach(kind => warnings.push(`diagram ${number}: \`:::${kind}\` is not a kind (see icons.json); the box has no icon`))
  Object.entries(boxes)
    .filter(([, each]) => !each.kind)
    .forEach(([id]) => warnings.push(`diagram ${number}: box \`${id}\` has no kind; give it one (\`${id}["…"]:::kind\`) so it gets an icon`))

  if (width > WIDEST) {
    warnings.push(`diagram ${number} is ${Math.round(width)}px wide and will scroll sideways: use fewer boxes, shorter labels or a top-down layout`)
  }

  return `<figure class="diagram${tall}" id="figure-${number}"><div class="canvas"><div class="stage" style="--natural: ${Math.round(width)}px">${svg}<div class="cards">${cards}</div></div></div>${list}</figure>`
}

const pieces = []
const sections = []
let title = basename(doc, '.md')
let count = 0
let lead = false

for (let index = 0; index < tokens.length; index += 1) {
  const token = tokens[index]

  if (token.type === 'heading' && token.depth === 1) {
    title = token.text
    lead = true
    continue
  }

  if (token.type === 'heading' && token.depth === 2) {
    sections.push({ name: token.text, prose: 0, diagrams: 0 })
  }

  const section = sections.at(-1)

  if (token.type === 'code' && token.lang === 'mermaid') {
    count += 1
    if (section) {
      section.diagrams += 1
    }
    let next = index + 1
    while (tokens[next] && tokens[next].type === 'space') {
      next += 1
    }
    const notes = noteItems(tokens[next])
    pieces.push(figure(String(count).padStart(2, '0'), notes))
    index = notes ? next : index
    continue
  }

  const aside = token.type === 'blockquote' ? callout(token) : null

  if (aside) {
    const at = pieces.findLastIndex(piece => !piece.startsWith('<aside'))
    const beside = at >= 0 && !/^<(h\d|figure)/.test(pieces[at])
    pieces.splice(beside ? at : pieces.length, 0, aside)
    continue
  }

  if (token.type === 'paragraph' && lead) {
    pieces.push(render(token).replace('<p>', '<p class="lead">'))
    lead = false
    continue
  }

  if (token.type === 'space') {
    continue
  }
  lead = false
  if (section && token.type !== 'heading') {
    section.prose += words(token.raw)
  }
  pieces.push(token.type === 'table' ? `<div class="table">${render(token)}</div>` : render(token))
}

const body = pieces
  .join('\n')
  .replace(/<code>([^<\s]+\.[A-Za-z0-9]+:\d+(?:-\d+)?)<\/code>/g, '<code class="ref">$1</code>')

let project = ''
try {
  project = basename(execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim())
} catch {
  project = basename(process.cwd())
}

const css = readFileSync(join(here, 'page.css'), 'utf8')
const js = readFileSync(join(here, 'page.js'), 'utf8')
const today = new Date().toISOString().slice(0, 10)

writeFileSync(
  out,
  `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
<main>
<header><p class="eyebrow">${escapeHtml(project)} · explained</p><h1>${marked.parseInline(title)}</h1></header>
<article>
${body}
</article>
<footer>${today} · written from <code>${escapeHtml(doc)}</code></footer>
</main>
<script>${js}</script>
</html>
`,
)

for (const section of sections) {
  if (section.diagrams === 0 && !/^where to look/i.test(section.name)) {
    warnings.push(`section "${section.name}" has no diagram: draw the idea, or fold the text into the notes of another diagram`)
  }

  if (section.diagrams > 0 && section.prose > PROSE * section.diagrams) {
    warnings.push(`section "${section.name}" has ${section.prose} words of text beside its diagram (limit ${PROSE}): move detail into the box notes or cut it`)
  }
}

warnings.forEach(warning => console.log(`warn  ${warning}`))
