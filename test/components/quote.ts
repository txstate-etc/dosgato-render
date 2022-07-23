import { Component, ComponentData } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export interface QuoteData extends ComponentData {
  author: string
  quote: string
}

export class QuoteTemplate extends Component<QuoteData> {
  static templateKey = 'keyc3'
  static cssBlocks = new Map([
    ['quote', {
      css: `
        .dg-quote { margin: 1em; padding: 1em; background-color: #DDDDDD; border: 1px solid #CCCCCC; }
        .dg-author { display: block; text-align: right; font-weight: bold; }
      `
    }]
  ])

  render () {
    return `<div class="dg-quote">${htmlEncode(this.data.quote)}<span class="dg-author">- ${htmlEncode(this.data.author)}</span></div>`
  }
}
