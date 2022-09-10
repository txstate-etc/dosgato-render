import { advanceHeader, Component, ComponentData, ContextBase, printHeader } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export interface RichTextData extends ComponentData {
  title: string
  text: string
}

export class RichTextTemplate extends Component<RichTextData, { processedText: string }> {
  static templateKey = 'richtext'
  static cssBlocks = new Map([
    ['richtext', {
      css: `
        @use 'mixins';
        .dg-rich-text img { max-width: 100%; }
        .sr-only { @include mixins.sr-only(); }
      `,
      sass: true
    }]
  ])

  async fetch () {
    const processedText = await this.api.processRich(this.data.text)
    return { processedText }
  }

  setContext <T extends ContextBase> (renderCtxFromParent: T) {
    return advanceHeader(renderCtxFromParent, this.data.title)
  }

  render () {
    return `${printHeader(this.renderCtx, htmlEncode(this.data.title))}<div class="dg-rich-text">${this.fetched.processedText}</div>`
  }
}
