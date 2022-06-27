import { Component, ComponentData } from '@dosgato/templating'
import { htmlEncode, isBlank } from 'txstate-utils'

export interface LinkData extends ComponentData {
  link: string
  text: string
}

export class LinkTemplate extends Component<LinkData> {
  static templateKey = 'keyc1'
  static cssBlocks = new Map([
    ['linktemplate', {
      css: `
        .dg-link { text-decoration: none; }
        .dg-link:hover { text-decoration: underline; }
      `
    }]
  ])

  render (renderedAreas: Map<string, string[]>, editMode: boolean) {
    return `${this.editBar({ editMode })}<a href="${htmlEncode(this.data.link)}" class="dg-link">${isBlank(this.data.text) ? htmlEncode(this.data.link) : htmlEncode(this.data.text)}</a>`
  }
}
