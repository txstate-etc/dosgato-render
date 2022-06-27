import { Component, ComponentData } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export interface RichTextData extends ComponentData {
  title: string
  text: string
}

export class QuoteTemplate extends Component<RichTextData> {
  static templateKey = 'richtext'
  static cssBlocks = new Map([
    ['richtext', {
      css: `
        .dg-rich-text img { max-width: 100%; }
      `
    }]
  ])

  render (renderedAreas: Map<string, string[]>, editMode: boolean) {
    return `${this.editBar({ editMode })}${this.data.title ? '<h2>' + htmlEncode(this.data.title) + '</h2>' : ''}<div class="dg-rich-text">${this.data.text}</div>`
  }
}
