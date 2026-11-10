import { Page, type PageForNavigation } from '@dosgato/templating'
import { htmlEncode, stringify } from 'txstate-utils'

export class PageTemplate1 extends Page<any, { navPages: PageForNavigation[], testDataByLink: any, testDataByPath: any, linksDefault: string }, any> {
  static templateKey = 'keyp1'
  static cssBlocks = new Map([
    ['blanktemplate', { css: `
      main, aside { padding: 1em; }
      .default-links { margin: 0; padding: 0; list-style: none; }
      .default-links li a { text-decoration: none; }
      .default-links li a:hover { text-decoration: underline; }
    ` }]
  ])

  static jsBlocks = new Map([
    ['blanktemplate_admin', {
      js: `
        const main = document.body.querySelector('main')
        const nav = document.body.querySelector('nav')
        window.addEventListener('message', e => {
          if (e.data.action !== 'pagebar') return
          if (main.isConnected) main.remove()
          else nav.after(main)
        })
      `
    }]
  ])

  jsBlocks () {
    return this.editMode ? ['blanktemplate_admin'] : []
  }

  async fetch () {
    const [root, navPages, testDataByLink, testDataByPath] = await Promise.all([
      this.api.getRootPage({ id: this.pageInfo.id }),
      this.api.getNavigation({}),
      this.api.getDataByLink(stringify({ type: 'data', templateKey: 'keyd1', path: '/site2/site2datafolder/red-content', id: 'itchanges', siteId: '2' })),
      this.api.getDataByPath('keyd2', '/global')
    ])
    if (root.id !== this.pageInfo.id) this.registerInherited('main', root.data.areas?.main ?? [], root.id)
    // default content for the links area, standing in for defaults inherited from an ancestor page
    const linksDefault = '<ul class="default-links"><li><a href="#">Default Link</a></li></ul>'
    return { navPages, testDataByLink, testDataByPath, linksDefault }
  }

  renderNavPage (p: PageForNavigation): string {
    return `
      <a href="${htmlEncode(p.href)}">${htmlEncode(p.title)}</a>
      <div style="padding-left: 1em">
        ${p.children.map(c => this.renderNavPage(c)).join('')}
      </div>
    `
  }

  renderTestDataByPath () {
    let data = ''
    for (const d of this.fetched.testDataByPath) {
      data += `
        <tr>
          <td>${htmlEncode(d.name)}</td>
          <td>${htmlEncode(d.floors)}</td>
        </tr>
      `
    }
    return data
  }

  render () {
    return `<!DOCTYPE html><html><head>${this.headContent}</head><body><nav>
      ${this.fetched.navPages.map(p => this.renderNavPage(p)).join('')}
    </nav>
    <aside>
      ${this.renderArea('links', { max: 1, defaultContent: this.fetched.linksDefault })}
    </aside>
    <main>
      <table>
        <caption>Data By Path /global</caption>
        <tr>
          <th>Building Name</th>
          <th>Floors</th>
        </tr>
        ${this.renderTestDataByPath()}
      </table>
      ${this.renderComponents('main')}${this.newBar('main')}
    </main>
    © 2022</body></html>`
  }
}
