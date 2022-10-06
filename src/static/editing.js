window.dgEditing = {
  target (el) { return el.closest('[data-path]') },
  path (el) {
    return this.barPath(this.target(el))
  },
  send (action, e) {
    const path = this.path(e.target)
    window.top.postMessage({ action, path }, '*')
  },
  select (e) {
    const bars = document.querySelectorAll('[data-path].selected')
    for (const bar of bars) bar.classList.remove('selected')
    this.target(e.target).classList.add('selected')
    this.send('select', e)
  },
  edit (e) {
    this.send('edit', e)
  },
  create (e) {
    this.send('create', e)
  },
  move (e) {
    this.send('move', e)
  },
  del (e) {
    this.send('del', e)
  },
  barPath (bar) {
    return bar.getAttribute('data-path')
  },
  droppable (bar) {
    const path = this.barPath(bar)
    const parentPath = bar.classList.contains('dg-new-bar') ? path : path.split('.').slice(0, -2).join('.')
    const draggingParentPath = this.dragging.split('.').slice(0, -2).join('.')
    return (path !== this.dragging && parentPath === draggingParentPath) || (this.validdrops.has(path) && !bar.disabled && bar.getAttribute('data-droppable') !== 'false')
  },
  enter (e) {
    const target = this.target(e.target)
    target.dragEnterCount = (target.dragEnterCount ?? 0) + 1
    if (this.droppable(target)) target.classList.add('dg-edit-over')
  },
  leave (e) {
    const target = this.target(e.target)
    target.dragEnterCount = Math.max(0, (target.dragEnterCount ?? 0) - 1)
    if (target.dragEnterCount === 0) target.classList.remove('dg-edit-over')
  },
  drag (e) {
    this.validdrops = new Set()
    const target = this.target(e.target)
    const path = this.barPath(target)
    this.dragging = path
    const bars = Array.from(document.querySelectorAll('.dg-edit-bar, .dg-new-bar'))
    const allpaths = bars.map(this.barPath)
    window.top.postMessage({ action: 'drag', path, allpaths }, '*')
    for (const bar of bars) bar.dragEnterCount = 0
  },
  drop (e) {
    const path = this.path(e.target)
    const target = this.target(e.target)
    target.classList.remove('dg-edit-over')
    if (this.droppable(target)) {
      e.preventDefault()
      window.top.postMessage({ action: 'drop', from: this.dragging, to: path }, '*')
    }
  },
  over (e) {
    const target = this.target(e.target)
    if (this.droppable(target)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  },
  message (e) {
    if ('validdrops' in e.data) {
      this.validdrops = e.data.validdrops
    }
  }
}

window.addEventListener('message', e => {
  window.dgEditing.message(e)
})

document.body.innerHTML += `
<svg style="display: none" version="2.0"><defs>
  <symbol id="dg-ed-add" viewbox="0 0 256 256">
    <title>Add</title>
    <path fill="currentColor" d="M222 128a6 6 0 0 1-6 6h-82v82a6 6 0 0 1-12 0v-82H40a6 6 0 0 1 0-12h82V40a6 6 0 0 1 12 0v82h82a6 6 0 0 1 6 6Z"/>
  </symbol>
  <symbol id="dg-ed-edit" viewbox="0 0 256 256">
    <title>Edit</title>
    <path fill="currentColor" d="m222.6 78.1l-44.7-44.7a14 14 0 0 0-19.8 0l-120 120a14.3 14.3 0 0 0-4.1 9.9V208a14 14 0 0 0 14 14h44.7a14.3 14.3 0 0 0 9.9-4.1l120-120a14.1 14.1 0 0 0 0-19.8ZM48.5 160L136 72.5L155.5 92L68 179.5ZM46 208v-33.5L81.5 210H48a2 2 0 0 1-2-2Zm50-.5L76.5 188l87.5-87.5l19.5 19.5ZM214.1 89.4L192 111.5L144.5 64l22.1-22.1a1.9 1.9 0 0 1 2.8 0l44.7 44.7a1.9 1.9 0 0 1 0 2.8Z"/>
  </symbol>
  <symbol id="dg-ed-move" viewbox="0 0 256 256">
    <title>Move</title>
    <path fill="currentColor" d="M160.5 199.5a5.9 5.9 0 0 1 0 8.5l-28.3 28.2a5.8 5.8 0 0 1-8.4 0L95.5 208a6 6 0 0 1 8.5-8.5l18 18V160a6 6 0 0 1 12 0v57.5l18-18a5.9 5.9 0 0 1 8.5 0ZM104 56.5l18-18V96a6 6 0 0 0 12 0V38.5l18 18a6 6 0 0 0 4.3 1.8a5.8 5.8 0 0 0 4.2-1.8a5.9 5.9 0 0 0 0-8.5l-28.3-28.2a5.8 5.8 0 0 0-8.4 0L95.5 48a6 6 0 0 0 8.5 8.5ZM38.5 134H96a6 6 0 0 0 0-12H38.5l18-18a6 6 0 0 0-8.5-8.5l-28.2 28.3a5.8 5.8 0 0 0 0 8.4L48 160.5a6 6 0 0 0 4.3 1.8a5.8 5.8 0 0 0 4.2-1.8a5.9 5.9 0 0 0 0-8.5Zm197.7-10.2L208 95.5a6 6 0 0 0-8.5 8.5l18 18H160a6 6 0 0 0 0 12h57.5l-18 18a5.9 5.9 0 0 0 0 8.5a5.8 5.8 0 0 0 4.2 1.8a6 6 0 0 0 4.3-1.8l28.2-28.3a5.8 5.8 0 0 0 0-8.4Z"/>
  </symbol>
  <symbol id="dg-ed-trash" viewbox="0 0 256 256">
    <title>Delete</title>
    <path fill="currentColor" d="M216 50h-42V40a22.1 22.1 0 0 0-22-22h-48a22.1 22.1 0 0 0-22 22v10H40a6 6 0 0 0 0 12h10v146a14 14 0 0 0 14 14h128a14 14 0 0 0 14-14V62h10a6 6 0 0 0 0-12ZM94 40a10 10 0 0 1 10-10h48a10 10 0 0 1 10 10v10H94Zm100 168a2 2 0 0 1-2 2H64a2 2 0 0 1-2-2V62h132Zm-84-104v64a6 6 0 0 1-12 0v-64a6 6 0 0 1 12 0Zm48 0v64a6 6 0 0 1-12 0v-64a6 6 0 0 1 12 0Z"/>
  </symbol>
</defs></svg>`
