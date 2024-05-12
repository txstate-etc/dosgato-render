import { advanceHeader, Component, type ComponentData, type ContextBase, printHeader, type AssetRecord } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export interface DocumentsData extends ComponentData {
  assetfolder: string
}

export class DocumentsTemplate extends Component<DocumentsData, { assets: AssetRecord[] }> {
  static templateKey = 'documents'

  async fetch () {
    const assets = await this.api.getAssetsByLink(this.data.assetfolder)
    console.log(this.data.assetfolder, assets)
    return { assets }
  }

  setContext (renderCtxFromParent: ContextBase) {
    return advanceHeader(renderCtxFromParent, this.data.title)
  }

  render () {
    return `${printHeader(this.renderCtx, htmlEncode(this.data.title))}
      <ul class="dg-documents">${this.fetched.assets.map(asset => `<li><a href="${htmlEncode(asset.downloadLink)}">${asset.filename}</a></li>`).join('')}</div>
    `
  }
}
