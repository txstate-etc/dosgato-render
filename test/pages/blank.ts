import { CSSBlock, Page } from '@dosgato/templating'

export class BlankTemplate extends Page {
  static templateKey = 'blank'
  static cssBlocks = new Map([
    ['blanktemplate', { css: 'main { padding: 1em; }' }]
  ])

  static jsBlocks = new Map([
    ['blanktemplate', { js: 'if (window.editMode) alert("This is edit mode!")' }]
  ])

  render (renderedAreas: Map<string, string[]>, editMode: boolean) {
    return `<!DOCTYPE html><html><head>${this.headContent}<script>window.editMode = ${String(editMode)}</script></head><body><main>${renderedAreas.get('main')?.join('') ?? ''}</main></body></html>`
  }
}
