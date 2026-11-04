import { expect, test } from '@playwright/test'
import { aboutQuoteV1, aboutQuoteV2, adminBase, authHeaders, extractResourceVersion, token } from './common.js'

// Preview, compare and edit renders, plus the static resource and proxy routes.

test('serves anonymous public previews without edit bars', async ({ request }) => {
  const resp = await request.get('/.preview/public/site1/about.html')
  expect(resp.status()).toBe(200)
  const html = await resp.text()
  expect(html).toContain(aboutQuoteV2)
  expect(html).not.toContain('dg-edit-bar')
})

test('redirects unauthenticated preview requests to the admin preview launcher', async ({ request }) => {
  const resp = await request.get('/.preview/latest/site1/about.html', { maxRedirects: 0 })
  expect(resp.status()).toBe(302)
  expect(resp.headers().location).toContain(`${adminBase}/preview?url=`)
})

test('previews specific page versions when authenticated', async ({ request }) => {
  const v1 = await request.get('/.preview/1/site1/about.html', { headers: authHeaders })
  expect(v1.status()).toBe(200)
  expect(await v1.text()).toContain(aboutQuoteV1)

  const v2 = await request.get('/.preview/2/site1/about.html', { headers: authHeaders })
  expect(v2.status()).toBe(200)
  expect(await v2.text()).toContain(aboutQuoteV2)
})

test('rejects unauthenticated edit requests', async ({ request }) => {
  const resp = await request.get('/.edit/site1/about.html')
  expect(resp.status()).toBe(401)
})

test('exchanges a token query param for a cookie and redirects', async ({ request }) => {
  const resp = await request.get(`/.edit/site1/about.html?token=${token}`, { maxRedirects: 0 })
  expect(resp.status()).toBe(302)
  expect(resp.headers().location).not.toContain('token=')
  expect(resp.headers()['set-cookie']).toContain('dg_token=')
})

test('renders edit mode with edit bars, inherit bars and the editing includes', async ({ request }) => {
  const resp = await request.get('/.edit/site1/about.html', { headers: authHeaders })
  expect(resp.status()).toBe(200)
  const html = await resp.text()
  // the page's own quote component is editable
  expect(html).toContain('<dg-edit-bar')
  expect(html).toContain('<dg-new-bar')
  // components inherited from the root page get inherit bars instead
  expect(html).toContain('<dg-inherit-bar')
  // editing support assets are linked
  expect(html).toContain('/edit.js')
  expect(html).toContain('/edit.css')
  expect(html).toContain('window.dgEditingBlocks')
})

test('serves registered css, js and file resources with immutable caching', async ({ request }) => {
  const page = await request.get('/.edit/site1/about.html', { headers: authHeaders })
  const html = await page.text()
  const version = extractResourceVersion(html)

  const css = await request.get(`/.resources/${version}/blanktemplate.css`)
  expect(css.status()).toBe(200)
  expect(css.headers()['content-type']).toContain('text/css')
  expect(css.headers()['cache-control']).toContain('immutable')
  // css blocks are served minified
  expect(await css.text()).toContain('main{padding:1em}')

  // keyp1 only includes this js block in edit mode
  const js = await request.get(`/.resources/${version}/blanktemplate_admin.js`)
  expect(js.status()).toBe(200)
  expect(js.headers()['content-type']).toContain('javascript')
  expect(await js.text()).toContain('pagebar')

  // the quote template registers woff2 font files, referenced by its css as url(roboto400)
  const font = await request.get(`/.resources/${version}/roboto400`)
  expect(font.status()).toBe(200)
  expect((await font.body()).length).toBeGreaterThan(1000)
})

test('compiles sass css blocks with scss includes', async ({ request }) => {
  const page = await request.get('/')
  const html = await page.text()
  const version = extractResourceVersion(html)

  // richtext's block is authored in sass using the sr-only and center includes
  const css = await request.get(`/.resources/${version}/richtext.css`)
  expect(css.status()).toBe(200)
  const body = await css.text()
  expect(body).toContain('.dg-rich-text')
  // @include sr.sr-only() expanded
  expect(body).toContain('.sr-only')
  expect(body).toContain('clip')
})

test('serves the editing js, css and spinner', async ({ request }) => {
  const page = await request.get('/.edit/site1/about.html', { headers: authHeaders })
  const version = extractResourceVersion(await page.text())

  const js = await request.get(`/.editing/${version}/edit.js`)
  expect(js.status()).toBe(200)
  expect(js.headers()['content-type']).toContain('javascript')

  const css = await request.get(`/.editing/${version}/edit.css`)
  expect(css.status()).toBe(200)
  expect(css.headers()['content-type']).toContain('text/css')

  const spinner = await request.get(`/.editing/${version}/spinner.html`)
  expect(spinner.status()).toBe(200)
  expect(spinner.headers()['content-type']).toContain('text/html')
})

test('renders a diff of two page versions', async ({ request }) => {
  const resp = await request.get('/.compare/1/2/site1/about.html', { headers: authHeaders })
  expect(resp.status()).toBe(200)
  const html = await resp.text()
  // htmldiff marks removed and inserted text and the route injects diff styling
  expect(html).toContain('<del')
  expect(html).toContain('<ins')
  expect(html).toContain('lightgreen')
})

test('proxies asset downloads to the api with translated auth', async ({ request }) => {
  const resp = await request.get('/.asset/a2/report.pdf', { headers: authHeaders })
  expect(resp.status()).toBe(200)
  expect(resp.headers()['content-type']).toContain('application/pdf')
  expect(await resp.text()).toBe('MOCKBYTES:a2')
})

test('proxies page downloads to the api', async ({ request }) => {
  const resp = await request.get('/.page/site1/about?published=1', { headers: authHeaders })
  expect(resp.status()).toBe(200)
  const body = await resp.json()
  expect(body.ok).toBe(true)
  expect(body.path).toBe('/pages/site1/about')
  expect(body.query.published).toBe('1')
})

test('responds to the token check route', async ({ request }) => {
  const resp = await request.get('/.token')
  expect(resp.status()).toBe(200)
  expect(await resp.text()).toBe('OK')
})
