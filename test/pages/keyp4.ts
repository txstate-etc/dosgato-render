import { Page } from '@dosgato/templating'

export class PageTemplate4 extends Page {
  static templateKey = 'keyp4'
  static cssBlocks = new Map([
    ['blanktemplate', { css: 'main { padding: 1em; }' }]
  ])

  static jsBlocks = new Map()

  render (renderedAreas: Map<string, string[]>, editMode: boolean) {
    return `<!DOCTYPE html><html><head>${this.headContent}<script>window.editMode = ${String(editMode)}</script></head><body><main>${renderedAreas.get('main')?.join('') ?? ''}${this.newBar('main', { editMode })}</main></body></html>`
  }
}
