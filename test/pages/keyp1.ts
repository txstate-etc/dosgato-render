import { Page, RenderedComponent } from '@dosgato/templating'

export class PageTemplate1 extends Page {
  static templateKey = 'keyp1'
  static cssBlocks = new Map([
    ['blanktemplate', { css: 'main { padding: 1em; }' }]
  ])

  static jsBlocks = new Map()

  render () {
    return `<!DOCTYPE html><html><head>${this.headContent}</head><body><main>${this.renderComponents('main')}${this.newBar('main')}</main></body></html>`
  }
}
