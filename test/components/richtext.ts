import { advanceHeader, Component, ComponentData, ContextBase, printHeader } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export interface RichTextData extends ComponentData {
  title: string
  text: string
}

export class RichTextTemplate extends Component<RichTextData> {
  static templateKey = 'richtext'
  static cssBlocks = new Map([
    ['richtext', {
      css: `
        .dg-rich-text img { max-width: 100%; }
      `
    }]
  ])

  setContext <T extends ContextBase> (renderCtxFromParent: T) {
    return advanceHeader(renderCtxFromParent, this.data.title)
  }

  render (renderedAreas: Map<string, string[]>) {
    return `${this.editBar()}${printHeader(this.renderCtx, htmlEncode(this.data.title))}<div class="dg-rich-text">${this.data.text}</div>`
  }
}
