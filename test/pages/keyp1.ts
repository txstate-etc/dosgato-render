import { Page, PageForNavigation } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export class PageTemplate1 extends Page<any, { navPages: PageForNavigation[] }, any> {
  static templateKey = 'keyp1'
  static cssBlocks = new Map([
    ['blanktemplate', { css: 'main { padding: 1em; }' }]
  ])

  static jsBlocks = new Map()

  async fetch () {
    const [root, navPages] = await Promise.all([
      this.api.getRootPage({ id: this.pageInfo.id }),
      this.api.getNavigation({})
    ])
    if (root.id !== this.pageInfo.id) this.registerInherited('main', root.data.areas?.main ?? [], root.id)
    return { navPages }
  }

  renderNavPage (p: PageForNavigation): string {
    return `
      <a href="${htmlEncode(p.href)}">${p.title}</a>
      <div style="padding-left: 1em">
        ${p.children.map(c => this.renderNavPage(c)).join('')}
      </div>
    `
  }

  render () {
    return `<!DOCTYPE html><html><head>${this.headContent}</head><body><nav>
      ${this.fetched.navPages.map(p => this.renderNavPage(p)).join('')}
    </nav><main>${this.renderComponents('main')}${this.newBar('main')}</main></body></html>`
  }
}
