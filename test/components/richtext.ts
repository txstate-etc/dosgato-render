import { advanceHeader, Component, ComponentData, ContextBase, printHeader } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'
import { getFilePath } from '../../src/index.js'

export interface RichTextData extends ComponentData {
  title: string
  text: string
}

export class RichTextTemplate extends Component<RichTextData> {
  static templateKey = 'richtext'
  static cssBlocks = new Map([
    ['richtext', {
      css: `
        @use 'sr-only' as sr;
        @use 'center';
        .dg-rich-text img { max-width: 100%; }
        .sr-only { @include sr.sr-only(); }
      `,
      sass: true
    }]
  ])

  static scssIncludes = new Map([
    ['sr-only', {
      path: getFilePath(import.meta.url, 'sr-only.scss')
    }],
    ['center', {
      path: getFilePath(import.meta.url, 'center.scss')
    }]
  ])

  async fetch () {
    await this.fetchRichText(this.data.text)
  }

  setContext (renderCtxFromParent: ContextBase) {
    return advanceHeader(renderCtxFromParent, this.data.title)
  }

  render () {
    return `${printHeader(this.renderCtx, htmlEncode(this.data.title))}<div class="dg-rich-text">${this.renderRichText(this.data.text, { advanceHeader: this.data.title })}</div>`
  }
}
