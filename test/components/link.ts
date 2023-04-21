import { Component, type ComponentData } from '@dosgato/templating'
import { htmlEncode, isBlank } from 'txstate-utils'

export interface LinkData extends ComponentData {
  link: string
  text: string
}

export class LinkTemplate extends Component<LinkData, { link?: string }> {
  static templateKey = 'keyc1'
  static cssBlocks = new Map([
    ['linktemplate', {
      css: `
        .dg-link { text-decoration: none; }
        .dg-link:hover { text-decoration: underline; }
      `
    }]
  ])

  async fetch () {
    return { link: await this.api.resolveLink(this.data.link) }
  }

  render () {
    return `<a href="${htmlEncode(this.fetched.link)}" class="dg-link">${isBlank(this.data.text) ? htmlEncode(this.data.link) : htmlEncode(this.data.text)}</a>`
  }
}
