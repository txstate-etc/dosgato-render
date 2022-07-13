window.dgEditing = {
  path (el) {
    return el.closest('[data-path]').getAttribute('data-path')
  },
  send (action, e) {
    const path = this.path(e.target)
    window.top.postMessage({ action, path }, '*')
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
  drag (e) {
    this.validdrops = new Set()
    const path = this.path(e.target)
    this.dragging = path
    const editbars = Array.from(document.querySelectorAll('.dg-edit-bar'))
    const allpaths = editbars.map(this.barPath)
    window.top.postMessage({ action: 'drag', path, allpaths }, '*')
  },
  drop (e) {
    this.send('drop', e)
    const path = this.path(e.target)
    if (this.validdrops.has(path)) e.preventDefault()
  },
  over (e) {
    const path = this.path(e.target)
    if (this.validdrops.has(path)) e.preventDefault()
  },
  message (e) {
    if (e.data.action === 'drag') {
      this.validdrops = e.data.validdrops
    }
  }
}

// prevent the user from navigating away from the page being edited
window.addEventListener('message', window.dgEditing.message);
(function () {
  const location = window.document.location

  const preventNavigation = function () {
    const originalHashValue = location.hash

    window.setTimeout(function () {
      location.hash = 'preventNavigation' + ~~(9999 * Math.random())
      location.hash = originalHashValue
    }, 0)
  }

  window.addEventListener('beforeunload', preventNavigation, false)
  window.addEventListener('unload', preventNavigation, false)
})()
