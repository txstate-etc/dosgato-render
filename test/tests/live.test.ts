import { expect, test } from '@playwright/test'
import { aboutQuoteV2, assetLiveBase, heroChecksum12 } from './common.js'

// Anonymous rendering of launched pages through the catch-all route. The
// compose service is named "render", so the Host header the render server
// sees is "render" and the mock API's site1 is launched at http://render/.

test('renders the launched home page with navigation, data queries and rich text', async ({ request }) => {
  const resp = await request.get('/')
  expect(resp.status()).toBe(200)
  expect(resp.headers()['content-type']).toContain('text/html')
  const html = await resp.text()
  // richtext component on the root page
  expect(html).toContain('Welcome')
  expect(html).toContain('Hello world, this is the home page rich text.')
  // getNavigation produced site-relative launched links
  expect(html).toContain('href="/about.html"')
  expect(html).toContain('href="/components.html"')
  // getDataByPath('keyd2', '/global') rendered the buildings table
  expect(html).toContain('Data By Path /global')
  expect(html).toContain('building-a')
  expect(html).toContain('building-b')
  // the keyc1 link component resolved its page link to a launched url
  expect(html).toContain('<a href="/about.html" class="dg-link">About Us</a>')
  // live renders include a canonical link
  expect(html).toContain('<link rel="canonical" href="http://render/">')
  // no edit bars on the live site
  expect(html).not.toContain('dg-edit-bar')
  expect(html).not.toContain('dg-new-bar')
})

test('redirects extensionless paths to .html preserving the querystring', async ({ request }) => {
  const resp = await request.get('/about?foo=1', { maxRedirects: 0 })
  expect(resp.status()).toBe(301)
  expect(resp.headers().location).toBe('/about.html?foo=1')
})

test('renders a child page including components inherited from the root page', async ({ request }) => {
  const resp = await request.get('/about.html')
  expect(resp.status()).toBe(200)
  const html = await resp.text()
  // the page's own quote component, at its published version
  expect(html).toContain(aboutQuoteV2)
  // keyp1's fetch() inherits the root page's main area into child pages
  expect(html).toContain('Hello world, this is the home page rich text.')
})

test('strips tracker params from the canonical link', async ({ request }) => {
  const resp = await request.get('/about.html?utm_source=news&keep=1')
  expect(resp.status()).toBe(200)
  // the surviving querystring is html-encoded into the canonical href
  expect(await resp.text()).toContain('<link rel="canonical" href="http://render/about.html?keep&#x3D;1">')
})

test('renders nested components, image srcsets and asset folder listings', async ({ request }) => {
  const resp = await request.get('/components.html')
  expect(resp.status()).toBe(200)
  const html = await resp.text()
  // panel with a horizontal rule inside its content area
  expect(html).toContain('Panel Title')
  expect(html).toContain('dg-horizonalrule')
  // column layout with two quotes
  expect(html).toContain('Column one quote')
  expect(html).toContain('Column two quote')
  // team / teammember nested areas
  expect(html).toContain('Jane Smith')
  expect(html).toContain('Director')
  // textimage resolved its asset link against the live asset base
  expect(html).toContain(`<img src="${assetLiveBase}/a1/w/2000/${heroChecksum12}/hero.png">`)
  // documents listed the asset folder's contents with download links
  expect(html).toContain(`${assetLiveBase}/a2/report.pdf`)
  expect(html).toContain('schedule.csv')
})

test('serves the site 404 page with a 404 status for unknown paths', async ({ request }) => {
  const resp = await request.get('/not-a-real-page.html')
  expect(resp.status()).toBe(404)
  expect(await resp.text()).toContain('The page you requested could not be found.')
})

test('renders the rss variation of a page', async ({ request }) => {
  const resp = await request.get('/feed.rss')
  expect(resp.status()).toBe(200)
  expect(resp.headers()['content-type']).toContain('application/rss+xml')
  const body = await resp.text()
  expect(body).toContain('<rss version="2.0"')
  expect(body).toContain('Sample RSS Feed')
})

test('renders the markdown variation of a page', async ({ request }) => {
  const resp = await request.get('/feed.md')
  expect(resp.status()).toBe(200)
  expect(resp.headers()['content-type']).toContain('text/markdown')
  expect(await resp.text()).toContain('Sample Markdown Content')
})

test('renders the html version of the variation page, including its slow fetch phase', async ({ request }) => {
  // keyp2's fetch() sleeps 2 seconds before rendering
  const resp = await request.get('/feed.html')
  expect(resp.status()).toBe(200)
  expect(await resp.text()).toContain('Feed content lives here.')
})
