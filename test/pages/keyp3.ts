import { Page, RenderedComponent } from '@dosgato/templating'

export class PageTemplate3 extends Page {
  static templateKey = 'keyp3'
  static cssBlocks = new Map([
    ['blanktemplate', { css: 'main { padding: 1em; }' }]
  ])

  static jsBlocks = new Map()

  render () {
    return `<!DOCTYPE html><html><head>${this.headContent}</head><body><main>${this.renderComponents('main')}${this.newBar('main')}</main></body></html>`
  }
}
