import { Component, ComponentData } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export interface PanelData extends ComponentData {
  title: string
}

export class PanelTemplate extends Component<PanelData> {
  static templateKey = 'keyc2'
  static cssBlocks = new Map([
    ['panel', {
      css: `
        .dg-panel { border: 1px solid black; }
      `
    }]
  ])

  render (renderedAreas: Map<string, string[]>, editMode: boolean) {
    return `${this.editBar({ editMode })}${this.data.title ? '<h2>' + htmlEncode(this.data.title) + '</h2>' : ''}<div class="dg-panel-body">${renderedAreas.get('content')?.join('') ?? ''}${this.newBar('content')}</div>`
  }
}
