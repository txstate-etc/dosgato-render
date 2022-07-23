import { Component, ComponentData, printHeader } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export interface TextImageData extends ComponentData {
  title: string
  text: string
  image: string
}

export class TextImageTemplate extends Component<TextImageData> {
  static templateKey = 'textimage'
  static cssBlocks = new Map([
    ['textimage', {
      css: `
        .dg-text-image { display: flex; align-items:center; }
      `
    }]
  ])

  render () {
    return `${printHeader(this.renderCtx, htmlEncode(this.data.title))}<div class="dg-text-image">${this.data.text}</div><img src="${htmlEncode(this.data.image)}">`
  }
}
