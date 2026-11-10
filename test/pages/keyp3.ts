import { Page } from '@dosgato/templating'

export class PageTemplate3 extends Page {
  static templateKey = 'keyp3'
  static cssBlocks = new Map([
    ['blanktemplate', { css: 'main { padding: 1em; }' }]
  ])

  static jsBlocks = new Map()

  render () {
    return `<!DOCTYPE html><html><head>${this.headContent}</head><body><main>${this.renderArea('main', { defaultContent: '<p class="default-main">This page has no content yet.</p>' })}</main></body></html>`
  }
}
