import { Component, type ComponentData } from '@dosgato/templating'
import path from 'path'
import { htmlEncode } from 'txstate-utils'
import { fileURLToPath } from 'url'

export interface QuoteData extends ComponentData {
  author: string
  quote: string
}

export class QuoteTemplate extends Component<QuoteData> {
  static templateKey = 'keyc3'
  static files = new Map([
    ['roboto400', { path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'roboto400.woff2') }],
    ['roboto400italic', { path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'roboto400italic.woff2') }]
  ])

  static cssBlocks = new Map([
    ['quote', {
      css: `
        .dg-quote { margin: 1em; padding: 1em; background-color: #DDDDDD; border: 1px solid #CCCCCC; }
        .dg-author { display: block; text-align: right; font-weight: bold; font-family: "Roboto"; }
      `
    }],
    ['roboto', {
      css: `
        @font-face {
          font-family: 'Roboto';
          font-style: normal;
          font-weight: 400;
          src: url(roboto400) format('woff2');
          unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
        }
        @font-face {
          font-family: 'Roboto';
          font-style: italic;
          font-weight: 400;
          src: url(roboto400italic) format('woff2');
          unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
        }
      `
    }]
  ])

  render () {
    return `<div class="dg-quote">${htmlEncode(this.data.quote)}<span class="dg-author">- ${htmlEncode(this.data.author)}</span></div>`
  }
}
