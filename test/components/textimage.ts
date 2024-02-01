import { Component, type ComponentData, printHeader } from '@dosgato/templating'
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
        .dg-text-image img { width: 50%; height: auto; }
      `
    }]
  ])

  async fetch () {
    const img = await this.api.getImgAttributes(this.data.image)
    return { img }
  }

  render () {
    return `
    ${printHeader(this.renderCtx, htmlEncode(this.data.title))}
    <div class="dg-text-image">
      <div class="dg-text-image-text">${this.data.text}</div>
      <img src="${htmlEncode(this.fetched.img.src)}">
    </div>
    `
  }
}
