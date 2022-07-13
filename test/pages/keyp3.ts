import { Page } from '@dosgato/templating'

export class PageTemplate3 extends Page {
  static templateKey = 'keyp3'
  static cssBlocks = new Map([
    ['blanktemplate', { css: 'main { padding: 1em; }' }]
  ])

  static jsBlocks = new Map()

  render (renderedAreas: Map<string, string[]>) {
    return `<!DOCTYPE html><html><head>${this.headContent}<script>window.editMode = ${String(this.editMode)}</script></head><body><main>${renderedAreas.get('main')?.join('') ?? ''}${this.newBar('main')}</main></body></html>`
  }
}
