// What a figure does when you use it:
//   point at a box or its note  -> that box, its arrows and its neighbours stay, the rest fades
//   click it                    -> it stays chosen until you click it again or press Escape
//   the arrows above the notes, -> walk the noted boxes in order
//   or the arrow keys
// A diagram that is not drawn as cards gets a numbered badge on each noted box instead.
const SVG = 'http://www.w3.org/2000/svg'

function badge(svg, box, number) {
  const rect = box.getBoundingClientRect()
  const pointed = box.querySelector('polygon') !== null
  const across = pointed ? (rect.left + rect.right) / 2 : rect.right
  const corner = new DOMPoint(across, rect.top).matrixTransform(svg.getScreenCTM().inverse())
  const group = document.createElementNS(SVG, 'g')
  const circle = document.createElementNS(SVG, 'circle')
  const text = document.createElementNS(SVG, 'text')

  group.setAttribute('class', 'badge')
  group.setAttribute('transform', `translate(${corner.x - (pointed ? 0 : 4)}, ${corner.y + 4})`)
  circle.setAttribute('r', '11')
  text.setAttribute('text-anchor', 'middle')
  text.setAttribute('dy', '0.35em')
  text.textContent = number
  group.append(circle, text)
  svg.append(group)
}

function plainBox(svg, note) {
  if (note.dataset.target) {
    return svg.querySelector(`[id="${note.dataset.target}"]`)
  }

  return note.dataset.actor ? svg.querySelector(`[name="${note.dataset.actor}"]`) : null
}

// Put each card on the box Mermaid drew for it, at the size the drawing has right now.
function place(stage, svg, cards) {
  const frame = stage.getBoundingClientRect()
  const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width

  stage.style.setProperty('--k', String(scale))
  for (const [id, card] of cards) {
    const box = svg.querySelector(`g.node[data-box="${id}"] > rect`).getBoundingClientRect()

    card.style.left = `${box.left - frame.left}px`
    card.style.top = `${box.top - frame.top}px`
    card.style.width = `${box.width}px`
    card.style.height = `${box.height}px`
  }
  stage.classList.add('placed')
}

function wire(figure) {
  const svg = figure.querySelector('svg')
  const stage = figure.querySelector('.stage')
  const notes = [...figure.querySelectorAll('.notes li')]
  const cards = new Map([...figure.querySelectorAll('.cards .card')].map(card => [card.dataset.box, card]))
  const arrows = [...svg.querySelectorAll('[data-from]')]
  const at = figure.querySelector('.walk .at')
  let chosen = null

  place(stage, svg, cards)
  new ResizeObserver(() => place(stage, svg, cards)).observe(stage)

  function show(id) {
    const lit = id !== null
    const near = new Set([id])

    figure.classList.toggle('focused', lit)
    for (const arrow of arrows) {
      const touches = lit && (arrow.dataset.from === id || arrow.dataset.to === id)

      arrow.classList.toggle('on', touches)
      svg.querySelector(`g.label[data-id="${arrow.dataset.id}"]`)?.parentElement.classList.toggle('on', touches)
      if (touches) {
        near.add(arrow.dataset.from).add(arrow.dataset.to)
      }
    }
    for (const [box, node] of cards) {
      node.classList.toggle('on', box === id)
      node.classList.toggle('near', lit && box !== id && near.has(box))
    }
    for (const note of notes) {
      note.classList.toggle('on', note.dataset.box === id)
    }
  }

  function choose(id) {
    chosen = chosen === id ? null : id
    show(chosen)

    const index = notes.findIndex(note => note.dataset.box === chosen)

    if (at) {
      at.textContent = index < 0 ? 'Step through' : `${index + 1} of ${notes.length}`
    }
    if (index >= 0) {
      notes[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }

  function step(by) {
    const index = notes.findIndex(note => note.dataset.box === chosen)
    const next = index < 0 ? (by > 0 ? 0 : notes.length - 1) : (index + by + notes.length) % notes.length

    chosen = null
    choose(notes[next].dataset.box)
  }

  for (const [id, node] of cards) {
    node.addEventListener('mouseenter', () => show(id))
    node.addEventListener('mouseleave', () => show(chosen))
    node.addEventListener('click', () => choose(id))
  }

  notes.forEach((note, index) => {
    const id = note.dataset.box

    if (!cards.has(id)) {
      const box = plainBox(svg, note)

      if (box) {
        badge(svg, box, String(index + 1))
      }

      return
    }

    note.addEventListener('mouseenter', () => show(id))
    note.addEventListener('mouseleave', () => show(chosen))
    note.addEventListener('click', () => choose(id))
  })

  figure.querySelectorAll('.walk button').forEach(button => button.addEventListener('click', () => step(Number(button.dataset.step))))
  figure.addEventListener('keydown', event => {
    const by = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]

    if (by) {
      event.preventDefault()
      step(by)
    }
    if (event.key === 'Escape' && chosen !== null) {
      choose(chosen)
    }
    if (event.key === 'Enter' && event.target.dataset.box) {
      choose(event.target.dataset.box)
    }
  })
}

document.querySelectorAll('figure.diagram').forEach(wire)
