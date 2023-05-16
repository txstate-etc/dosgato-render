import { Page, RenderedComponent } from '@dosgato/templating'

export class PageTemplate2 extends Page {
  static templateKey = 'keyp2'
  static cssBlocks = new Map([
    ['blanktemplate', { css: 'main { padding: 1em; }' }]
  ])

  static jsBlocks = new Map()

  render () {
    return `<!DOCTYPE html><html><head>${this.headContent}</head><body><main>${this.renderComponents('main')}${this.newBar('main')}</main></body></html>`
  }

  renderVariation (extension: string): string {
    if (extension === 'rss') {
      return `
        <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
          <channel>
            <title>Sample RSS Feed</title>
            <link>${this.url}</link>
            <atom:link href="${this.variationUrl('rss')}" rel="self" type="application/rss+xml" />
            <description></description>
            <language>en-us</language>
            <generator>Test CMS</generator>
            <managingEditor>someone@example.com</managingEditor>
            <webMaster>someoneelse@example.com</webMaster>
            <pubDate>${this.pageInfo.modifiedAt.toString()}</pubDate>
            <lastBuildDate>${Date.now().toString()}</lastBuildDate>
            <item>
              <pubDate>${Date.now().toString()}</pubDate>
              <title>Fake RSS Item</title>
              <link>http://www.example.com</link>
              <author>Dr. Seuss</author>
              <description>
                This is not a real RSS item. It contains no useful information.
              </description>
              <guid>abc123</guid>
            </item>
          </channel>
        </rss>
      `
    } else return super.renderVariation(extension)
  }
}
