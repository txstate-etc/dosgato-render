/* eslint-disable no-undef */
window.dgEditing = {
  target (el) { return el.getRootNode().host },
  path (el) {
    return this.barPath(this.target(el))
  },
  label (el) {
    return this.barLabel(this.target(el))
  },
  send (action, e) {
    const path = this.path(e.target)
    window.top.postMessage({ action, path }, '*')
  },
  _select (barTarget) {
    const bars = document.querySelectorAll('[data-path].selected')
    for (const bar of bars) bar.classList.remove('selected')
    barTarget.classList.add('selected')
    window.top.postMessage({
      action: 'select',
      path: this.barPath(barTarget),
      label: this.barLabel(barTarget),
      maxreached: barTarget.getAttribute('data-maxreached') === 'true' || barTarget.hasAttribute('disabled'),
      mayDelete: !barTarget.hasAttribute('disable-delete')
    }, '*')
  },
  select (e) {
    e.stopPropagation()
    this._select(this.target(e.target))
  },
  deselect (e) {
    window.top.postMessage({ action: 'deselect' }, '*')
    const bars = document.querySelectorAll('[data-path].selected')
    for (const bar of bars) bar.classList.remove('selected')
  },
  edit (e) {
    e.stopPropagation()
    this.send('edit', e)
  },
  create (e) {
    e.stopPropagation()
    this.send('create', e)
  },
  move (e) {
    this.send('move', e)
  },
  del (e) {
    this.send('del', e)
  },
  jump (pageId) {
    window.top.postMessage({ action: 'jump', pageId }, '*')
  },
  barPath (bar) {
    return bar.getAttribute('data-path')
  },
  barLabel (bar) {
    return bar.getAttribute('label')
  },
  isDroppable (bar, dragging) {
    const path = this.barPath(bar)
    return !bar.hasAttribute('disabled') && (
      bar.getAttribute('data-maxreached') !== 'true' || path.split('.').slice(0, -1).join('.') === dragging.split('.').slice(0, -1).join('.')
    )
  },
  enter (e) {
    const target = this.target(e.target)
    const path = this.barPath(target)
    target.dragEnterCount = (target.dragEnterCount ?? 0) + 1
    if (this.droppable[path]) target.classList.add('dg-edit-over')
  },
  focus (e) {
    this._select(this.target(e.target))
  },
  keydown (e) {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'x') {
        this.send('cut', e)
      } else if (e.key === 'c') {
        this.send('copy', e)
      } else if (e.key === 'v') {
        this.send('paste', e)
      } else if (e.key === 'm') {
        e.preventDefault()
        e.stopPropagation()
        this.send('menu', e)
      }
    } else if (e.key === 'Escape') {
      this.send('cancelCopy', e)
    }
    if (e.ctrlKey || e.altKey || e.metaKey || e.key === 'Insert') return
    if (e.key === 'Escape') {
      this.deselect()
      document.activeElement.blur()
      this.send('menu', e)
    }
  },
  leave (e) {
    const target = this.target(e.target)
    target.dragEnterCount = Math.max(0, (target.dragEnterCount ?? 0) - 1)
    if (target.dragEnterCount === 0) target.classList.remove('dg-edit-over')
  },
  drag (e) {
    this.droppable = {}
    const target = this.target(e.target)
    this._select(target)
    const path = this.barPath(target)
    this.dragging = path
    const bars = Array.from(document.querySelectorAll('[data-path]'))
    const allpaths = bars.map(this.barPath)
    window.top.postMessage({ action: 'drag', path, allpaths }, '*')
    for (const bar of bars) bar.dragEnterCount = 0
  },
  dragend (e) {
    this.dragging = undefined
    const bars = Array.from(document.querySelectorAll('[data-path]'))
    for (const bar of bars) bar.classList.remove('dg-yes-drop', 'dg-no-drop', 'dg-dragging', 'dg-dragging-below')
  },
  drop (e) {
    const target = this.target(e.target)
    const path = this.barPath(target)
    target.classList.remove('dg-edit-over')
    if (this.droppable[path]) {
      e.preventDefault()
      window.top.postMessage({ action: 'drop', from: this.dragging, to: path }, '*')
    }
  },
  over (e) {
    const path = this.path(e.target)
    if (this.droppable[path]) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  },
  init () {
    const bars = Array.from(document.querySelectorAll('[data-path]'))
    const allpaths = bars.map(this.barPath)
    const editbarpaths = bars.filter(b => b.tagName === 'DG-EDIT-BAR').map(this.barPath)
    window.top.postMessage({ action: 'maymove', allpaths, editbarpaths }, '*')
  },
  message (e) {
    if (typeof e.data !== 'object') return // in case we receive non-dosgato events from an iframe embedded in the page being edited
    if ('validdrops' in e.data && this.dragging) {
      const { validdrops } = e.data
      const bars = Array.from(document.querySelectorAll('[data-path]'))
      const barByPath = bars.reduce((barByPath, bar) => {
        barByPath[this.barPath(bar)] = bar
        return barByPath
      }, {})
      const paths = Object.keys(barByPath)
      for (const path of paths) {
        this.droppable[path] = validdrops.has(path) && this.isDroppable(barByPath[path], this.dragging)
      }
      const belowDragging = this.dragging.replace(/\.(\d+)$/, (_, idx) => `.${parseInt(idx) + 1}`)
      for (const path of paths) {
        if (path === belowDragging) barByPath[path].classList.add('dg-dragging-below')
        if (path === this.dragging) barByPath[path].classList.add('dg-dragging')
        else if (!this.droppable[path]) barByPath[path].classList.add('dg-no-drop')
        else barByPath[path].classList.add('dg-yes-drop')
      }
    } else if ('scrollTop' in e.data) {
      this.state = e.data.state
      for (const cb of this.stateCallbacks) {
        try {
          cb(this.state)
        } catch (e) {
          console.error(e)
        }
      }
      this.stateCallbacks = undefined
      window.scrollTo({ top: e.data.scrollTop })
      let bar = document.querySelector(`[data-path="${e.data.selectedPath}"]`)
      if (!bar) {
        /* The max warning might be hidden in an area that has the maximum number of
          components and in that case, there will be no bar. */
        const barsInArea = Array.from(document.querySelectorAll(`[data-path^="${e.data.selectedPath}."]`)).filter(b => {
          const path = b.dataset.path.replace(e.data.selectedPath, '')
          return path.match(/^\.\d+$/)
        })
        if (barsInArea.length && barsInArea.some(b => b.dataset.maxreached === 'true')) {
          bar = barsInArea[barsInArea.length - 1]
        } else return
      }
      this._select(bar)
      bar.scrollIntoView({ block: 'nearest' })
      const button = bar.shadowRoot.querySelector('button')
      if (button) {
        if (!button.disabled) {
          button.focus()
        } else {
          /* They added a new component and the maximum number of components for the area has been
            reached. Focus on the last component in the area. */
          const barsInArea = document.querySelectorAll(`[data-path^="${e.data.selectedPath}."]`)
          barsInArea[barsInArea.length - 1].shadowRoot.querySelector('button')?.focus()
        }
      }
    } else if ('focus' in e.data) {
      const bar = document.querySelector(`[data-path="${e.data.focus}"]`)
      bar.shadowRoot.querySelector('button')?.focus()
    } else if ('movablePaths' in e.data) {
      this.movablePaths = e.data.movablePaths
      const bars = Array.from(document.querySelectorAll('[data-path]'))
      for (const bar of bars) {
        bar.setAttribute('draggable', this.movablePaths.has(this.barPath(bar)))
      }
    }
  },
  saveState (key, val) {
    this.state = { ...this.state, [key]: val }
    window.top.postMessage({ action: 'save', state: this.state }, '*')
  },
  stateCallbacks: [],
  onStateLoaded (cb) {
    if (this.stateCallbacks == null) cb(this.state)
    else this.stateCallbacks.push(cb)
  },
  pagebarFocus (buttonIndex) {
    window.top.postMessage({ action: 'pagebarFocus', buttonIndex }, '*')
  }
}

window.addEventListener('message', e => {
  window.dgEditing.message(e)
})

window.addEventListener('scroll', () => {
  window.top.postMessage({ action: 'scroll', scrollTop: document.scrollingElement.scrollTop }, '*')
})

window.addEventListener('click', () => window.dgEditing.deselect())

/**
 * Prevent any links from navigating the iframe away
 */
function stopNav (e) {
  e.preventDefault()
}
function stopLinks () {
  const links = document.querySelectorAll('a[href]')
  for (const link of links) {
    link.removeEventListener('click', stopNav)
    link.addEventListener('click', stopNav)
  }
}
const mutationobserver = new window.MutationObserver(stopLinks)
mutationobserver.observe(document.body, {
  subtree: true,
  childList: true,
  attributes: false,
  characterData: false
})
stopLinks()

function randomid (length = 10) {
  return String.fromCharCode(97 + Math.floor(Math.random() * 26)) + Math.random().toString(36).slice(2, length + 1)
}
const currentUrl = import.meta.url
const currentVersion = currentUrl.match(/\/.editing\/(.*?)\/edit\.js/)[1]
const editingCss = currentUrl.replace(/\.js$/, '.css')
const addIcon = '<svg version="2.0" aria-hidden="true" viewbox="0 0 256 256"><title>Add</title><path fill="currentColor" d="M222 128a6 6 0 0 1-6 6h-82v82a6 6 0 0 1-12 0v-82H40a6 6 0 0 1 0-12h82V40a6 6 0 0 1 12 0v82h82a6 6 0 0 1 6 6Z"/></svg>'
const editIcon = '<svg version="2.0" aria-hidden="true" viewbox="0 0 256 256"><title>Edit</title><path fill="currentColor" d="m222.6 78.1l-44.7-44.7a14 14 0 0 0-19.8 0l-120 120a14.3 14.3 0 0 0-4.1 9.9V208a14 14 0 0 0 14 14h44.7a14.3 14.3 0 0 0 9.9-4.1l120-120a14.1 14.1 0 0 0 0-19.8ZM48.5 160L136 72.5L155.5 92L68 179.5ZM46 208v-33.5L81.5 210H48a2 2 0 0 1-2-2Zm50-.5L76.5 188l87.5-87.5l19.5 19.5ZM214.1 89.4L192 111.5L144.5 64l22.1-22.1a1.9 1.9 0 0 1 2.8 0l44.7 44.7a1.9 1.9 0 0 1 0 2.8Z"/></svg>'
const moveIcon = '<svg version="2.0" aria-hidden="true" viewbox="0 0 256 256"><title>Move</title><path fill="currentColor" d="M160.5 199.5a5.9 5.9 0 0 1 0 8.5l-28.3 28.2a5.8 5.8 0 0 1-8.4 0L95.5 208a6 6 0 0 1 8.5-8.5l18 18V160a6 6 0 0 1 12 0v57.5l18-18a5.9 5.9 0 0 1 8.5 0ZM104 56.5l18-18V96a6 6 0 0 0 12 0V38.5l18 18a6 6 0 0 0 4.3 1.8a5.8 5.8 0 0 0 4.2-1.8a5.9 5.9 0 0 0 0-8.5l-28.3-28.2a5.8 5.8 0 0 0-8.4 0L95.5 48a6 6 0 0 0 8.5 8.5ZM38.5 134H96a6 6 0 0 0 0-12H38.5l18-18a6 6 0 0 0-8.5-8.5l-28.2 28.3a5.8 5.8 0 0 0 0 8.4L48 160.5a6 6 0 0 0 4.3 1.8a5.8 5.8 0 0 0 4.2-1.8a5.9 5.9 0 0 0 0-8.5Zm197.7-10.2L208 95.5a6 6 0 0 0-8.5 8.5l18 18H160a6 6 0 0 0 0 12h57.5l-18 18a5.9 5.9 0 0 0 0 8.5a5.8 5.8 0 0 0 4.2 1.8a6 6 0 0 0 4.3-1.8l28.2-28.3a5.8 5.8 0 0 0 0-8.4Z"/></svg>'
const trashIcon = '<svg version="2.0" aria-hidden="true" viewbox="0 0 256 256"><title>Delete</title><path fill="currentColor" d="M216 50h-42V40a22.1 22.1 0 0 0-22-22h-48a22.1 22.1 0 0 0-22 22v10H40a6 6 0 0 0 0 12h10v146a14 14 0 0 0 14 14h128a14 14 0 0 0 14-14V62h10a6 6 0 0 0 0-12ZM94 40a10 10 0 0 1 10-10h48a10 10 0 0 1 10 10v10H94Zm100 168a2 2 0 0 1-2 2H64a2 2 0 0 1-2-2V62h132Zm-84-104v64a6 6 0 0 1-12 0v-64a6 6 0 0 1 12 0Zm48 0v64a6 6 0 0 1-12 0v-64a6 6 0 0 1 12 0Z"/></svg>'

class SharedBar extends HTMLElement {
  copyAttribute (el, attr) {
    if (this.hasAttribute(attr)) el.setAttribute(attr, this.getAttribute(attr))
    else el.removeAttribute(attr)
  }

  setClass (baseClass) {
    const classes = this.getAttribute('class')?.split(' ').filter(Boolean)
    this.bar.setAttribute('class', baseClass)
    if (classes?.length) this.bar.classList.add(...classes)
  }

  installCss () {
    const style = document.createElement('style')
    style.innerHTML = `@import url(${editingCss});` + window.dgEditingBlocks.map(block => `@import url(/.resources/${currentVersion}/${block}.css);`).join('')
    this.tmpl.appendChild(style)
  }

  connectedCallback () {
    if (this.initialized) return
    this.initialized = true
    this.attachShadow({ mode: 'open' })
    this.init()
  }
}

const editBar = document.createElement('template')
editBar.innerHTML = `
<div tabindex="-1" draggable="true" onclick="dgEditing.select(event)" ondragstart="dgEditing.drag(event)" ondragend="dgEditing.dragend(event)" ondragenter="dgEditing.enter(event)" ondragleave="dgEditing.leave(event)" ondragover="dgEditing.over(event)" ondrop="dgEditing.drop(event)" onkeydown="dgEditing.keydown(event)">
  <span class="dg-edit-bar-label"></span>
  <div class="dg-edit-bar-buttons">
    <span class="dg-edit-bar-move">${moveIcon}</span>
  </div>
</div>`
class EditBar extends SharedBar {
  static get observedAttributes () { return ['class', 'disable-delete', 'draggable'] }

  attributeChangedCallback () {
    if (!this.bar) return
    this.setClass('dg-edit-bar')
    this.trash.disabled = this.hasAttribute('disable-delete')
    this.bar.setAttribute('draggable', this.trash.disabled || this.getAttribute('draggable'))
  }

  init () {
    this.tmpl = editBar.content.cloneNode(true)
    this.bar = this.tmpl.querySelector('div')
    this.buttons = this.tmpl.querySelector('.dg-edit-bar-buttons')
    this.installCss()
    const label = this.bar.querySelector('.dg-edit-bar-label')
    const labelText = this.getAttribute('label')
    const id = randomid()
    label.setAttribute('id', id)
    label.innerText = labelText

    if (!this.hasAttribute('hide-edit')) {
      this.editButton = document.createElement('button')
      this.editButton.addEventListener('click', e => window.dgEditing.edit(e))
      this.editButton.addEventListener('focus', e => window.dgEditing.focus(e))
      this.editButton.innerHTML = `${editIcon}<span class="visuallyhidden">Edit ${labelText}</span>`
      this.buttons.appendChild(this.editButton)
    }

    this.trash = document.createElement('button')
    this.trash.disabled = this.hasAttribute('disable-delete')
    this.trash.addEventListener('click', e => window.dgEditing.del(e))
    this.trash.addEventListener('focus', e => window.dgEditing.focus(e))
    this.trash.innerHTML = `${trashIcon}<span class="visuallyhidden">Delete ${labelText}</span>`
    this.buttons.appendChild(this.trash)

    this.attributeChangedCallback()
    this.shadowRoot.appendChild(this.tmpl)
  }
}
window.customElements.define('dg-edit-bar', EditBar)

const newBar = document.createElement('template')
newBar.innerHTML = `
<button onclick="dgEditing.create(event)" ondragenter="dgEditing.enter(event)" ondragleave="dgEditing.leave(event)" ondragover="dgEditing.over(event)" ondrop="dgEditing.drop(event)" onfocus="dgEditing.focus(event)" onkeydown="dgEditing.keydown(event)">
  ${addIcon}<span class="dg-new-bar-label"></span>
</button>`
class NewBar extends SharedBar {
  static get observedAttributes () { return ['class', 'disabled'] }

  attributeChangedCallback () {
    if (!this.bar) return
    this.copyAttribute(this.bar, 'disabled')
    this.setClass('dg-new-bar')
  }

  init () {
    this.tmpl = newBar.content.cloneNode(true)
    this.bar = this.tmpl.querySelector('button')
    this.installCss()
    const label = this.bar.querySelector('.dg-new-bar-label')
    label.innerText = this.getAttribute('label')
    this.attributeChangedCallback()
    this.shadowRoot.appendChild(this.tmpl)
  }
}
window.customElements.define('dg-new-bar', NewBar)

const inheritBar = document.createElement('template')
inheritBar.innerHTML = `
<div>
  <span class="dg-edit-bar-label"></span>
  <button role="link" class="jump-to-original">Jump to Original</button>
</div>`
class InheritBar extends SharedBar {
  static get observedAttributes () { return ['class'] }

  attributeChangedCallback () {
    if (!this.bar) return
    this.setClass('dg-edit-bar dg-edit-bar-inherited')
  }

  init () {
    this.tmpl = inheritBar.content.cloneNode(true)
    this.bar = this.tmpl.querySelector('div')
    this.installCss()
    const label = this.bar.querySelector('.dg-edit-bar-label')
    const id = randomid()
    label.setAttribute('id', id)
    label.innerText = this.getAttribute('label')

    const button = this.bar.querySelector('button')
    button.setAttribute('aria-describedby', id)
    button.addEventListener('click', e => dgEditing.jump(this.getAttribute('inherited-from')))

    this.attributeChangedCallback()
    this.shadowRoot.appendChild(this.tmpl)
  }
}
window.customElements.define('dg-inherit-bar', InheritBar)

document.addEventListener('DOMContentLoaded', () => dgEditing.init())
