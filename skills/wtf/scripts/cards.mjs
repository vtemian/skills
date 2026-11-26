// Prepare a flowchart for drawing as cards. Used by render.mjs.
//
// Mermaid keeps the layout and the arrows; the page draws the boxes itself. So each
// declared box  id["title | detail"]:::kind  becomes a box holding one empty element
// of the size its card will have, and its title, detail and kind are returned beside
// the new text. A diagram that is not a flowchart returns null and is drawn as it is.

const BY_SHAPE = { '{': 'decision', '{{': 'decision', '[(': 'database', '((': 'start', '([': 'start' }
const BOX =
  /(subgraph\s+)?\b([A-Za-z][\w-]*)[ \t]*(\(\[|\[\(|\(\(|\[\[|\{\{|\[\/|\[|\(|\{)[ \t]*"([^"]*)"[ \t]*(\]\)|\)\]|\)\)|\]\]|\}\}|\/\]|\]|\)|\})(?::::([\w-]+))?/g

function size(box) {
  const letters = Math.max(box.title.length * 7.9, box.detail.length * 7)
  const icon = box.kind ? 44 : 0

  return { width: Math.round(Math.min(Math.max(letters + icon + 30, 110), 330)), height: box.detail ? 58 : 46 }
}

export function cards(text, kinds) {
  if (!/^\s*(flowchart|graph)\b/.test(text)) {
    return null
  }

  const boxes = {}
  const unknown = new Set()
  const classed = {}
  for (const line of text.matchAll(/^\s*class\s+([\w,-]+)\s+([\w-]+)\s*$/gm)) {
    for (const id of line[1].split(',')) {
      classed[id] = line[2]
    }
  }

  const drawn = text.replace(BOX, (whole, group, id, open, label, _close, kind) => {
    if (group) {
      return whole
    }

    const [title, detail = ''] = label.split('|').map(part => part.trim())
    const chosen = kind || classed[id] || BY_SHAPE[open] || ''

    if (chosen && !kinds[chosen]) {
      unknown.add(chosen)
    }

    boxes[id] = { title, detail, kind: kinds[chosen] ? chosen : '' }
    const { width, height } = size(boxes[id])

    return `${id}["<div style='width:${width - 32}px;height:${height - 24}px' data-node='${id}'></div>"]`
  })

  return { text: drawn.replace(/^\s*class\s+[\w,-]+\s+[\w-]+\s*$/gm, ''), boxes, unknown: [...unknown] }
}
