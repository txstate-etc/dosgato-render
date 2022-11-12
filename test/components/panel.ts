import { advanceHeader, Component, ComponentData, ContextBase, printHeader } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export interface PanelData extends ComponentData {
  title: string
}

export class PanelTemplate extends Component<PanelData> {
  static templateKey = 'keyc2'
  static cssBlocks = new Map([
    ['panel_edit', {
      targetsEditBars: true,
      css: `
        .dg-panel-bar { border-color: green; }
      `
    }],
    ['panel', {
      css: `
        .dg-panel {
          width: 80%;
          margin: auto;
          padding: 1em;
          border: 1px solid #CCCCCC;
        }
        .dg-panel h2, .dg-panel h3, .dg-panel h4, .dg-panel h5, .dg-panel h6 {
          margin-top: 0;
        }
      `
    }]
  ])

  newLabel () {
    return 'Add Panel Content'
  }

  setContext (renderCtxFromParent: ContextBase) {
    return advanceHeader(renderCtxFromParent, this.data.title)
  }

  render () {
    return `<div class="dg-panel">${printHeader(this.renderCtx, htmlEncode(this.data.title))}<div class="dg-panel-body">${this.renderArea('content', { max: 2, editBarOpts: { extraClass: 'dg-panel-bar' } })}</div></div>`
  }
}
