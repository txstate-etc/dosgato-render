import { type APIClient, type ResourceProvider } from '@dosgato/templating'
import cookie from '@fastify/cookie'
import { Blob } from 'node:buffer'
import { type FastifyRequest } from 'fastify'
import Server, { type FastifyTxStateOptions, HttpError } from 'fastify-txstate'
import { createReadStream, readFileSync } from 'node:fs'
import htmldiff from 'node-htmldiff'
import { isNotBlank, rescue, toQuery } from 'txstate-utils'
import { RenderingAPIClient, download } from './api.js'
import { type RegistryFile, templateRegistry } from './registry.js'
import { renderPage } from './render.js'
import { parsePath } from './util.js'
import { schemaversion } from './version.js'

function getToken (req: FastifyRequest<{ Querystring: { token?: string } }>) {
  const header = req.headers.authorization?.split(' ') ?? []
  if (header[0] === 'Bearer') return header[1]
  return req.cookies.dg_token
}

type APIClientClass = new <T extends APIClient> (published: boolean, req: FastifyRequest) => T

async function checkApiHealth () {
  const localApiBase = process.env.DOSGATO_LOCAL_API_BASE
  if (!localApiBase) return
  const resp = await fetch(localApiBase + '/health')
  return resp.ok ? undefined : { status: resp.status, message: await resp.text() }
}

export class RenderingServer extends Server {
  private APIClient!: APIClientClass

  constructor (config?: FastifyTxStateOptions) {
    const existingCheckOrigin = config?.checkOrigin
    config ??= {}
    config.checkOrigin = (req: FastifyRequest) => {
      if (existingCheckOrigin?.(req)) return true
      if (req.routerPath === '/.editing/:version/edit.js' || req.routerPath === '/.edit/*') return true
      if (req.routerPath === '/.resources/:version/:file') {
        return req.headers.origin === 'null'
      }
      return false
    }
    const existingCheckHealth = config?.checkHealth
    config.checkHealth = existingCheckHealth
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      ? async () => (await existingCheckHealth()) || await checkApiHealth()
      : checkApiHealth
    super(config)

    void this.app.register(cookie)
    this.app.addHook('preHandler', async (req, res) => {
      const token: string | undefined = (req as any).query?.token
      if (token) {
        void res.setCookie('dg_token', token, { httpOnly: true, sameSite: 'strict', path: '/.edit/' })
        void res.setCookie('dg_token', token, { httpOnly: true, sameSite: 'strict', path: '/.preview/' })
        void res.setCookie('dg_token', token, { httpOnly: true, sameSite: 'strict', path: '/.compare/' })
        void res.setCookie('dg_token', token, { httpOnly: true, sameSite: 'strict', path: '/.asset/' })
        void res.setCookie('dg_token', token, { httpOnly: true, sameSite: 'strict', path: '/.page/' })
        const withoutToken = new URL(req.url, `${req.protocol}://${req.hostname}`)
        withoutToken.searchParams.delete('token')
        void res.redirect(withoutToken.toString(), 302)
      }
    })

    /**
     * Route for preview renders - no edit bars, anonymous access only when
     * :version is 'public'
     */
    this.app.get<{ Params: { '*': string, version: string }, Querystring: { token?: string } }>(
      '/.preview/:version/*',
      async (req, res) => {
        const { path, extension } = parsePath(req.params['*'])
        const published = req.params.version === 'public' ? true : undefined
        const version = published || req.params.version === 'latest' ? undefined : parseInt(req.params.version, 10)
        if (version != null && isNaN(version)) throw new HttpError(404)
        const token = getToken(req)
        if (!token && !published) void res.redirect(`${process.env.DOSGATO_ADMIN_BASE!}/preview?url=${encodeURIComponent(`${req.protocol}://${req.hostname}${req.url}`)}`, 302)
        const api = new this.APIClient<RenderingAPIClient>(!!published, req)
        api.context = 'preview'
        const page = await rescue(api.getPreviewPage(token, path, schemaversion, published, version), { condition: e => e.message.includes('permitted') })
        if (!page) throw new HttpError(404)
        api.pagetreeId = page.pagetree.id
        api.siteId = page.site.id
        api.sitename = page.site.name
        return await renderPage(api, req, res, page, extension, false)
      }
    )

    /**
     * Route for a diff render that compares two versions
     */
    this.app.get<{ Params: { '*': string, fromVersion: string, toVersion: string }, Querystring: { token?: string } }>(
      '/.compare/:fromVersion/:toVersion/*',
      async (req, res) => {
        const { path, extension } = parsePath(req.params['*'])
        const token = getToken(req)
        if (!token) void res.redirect(`${process.env.DOSGATO_ADMIN_BASE!}/preview?url=${encodeURIComponent(`${req.protocol}://${req.hostname}${req.url}`)}`, 302)
        const api = new this.APIClient<RenderingAPIClient>(false, req)
        api.context = 'preview'
        const fromVersionNum = parseInt(req.params.fromVersion, 10)
        const toVersionNum = parseInt(req.params.toVersion, 10)
        if (isNaN(fromVersionNum) || isNaN(toVersionNum)) throw new HttpError(404)
        const [fromPage, toPage] = await Promise.all([
          rescue(api.getPreviewPage(token, path, schemaversion, undefined, fromVersionNum), { condition: e => e.message.includes('permitted') }),
          rescue(api.getPreviewPage(token, path, schemaversion, undefined, toVersionNum), { condition: e => e.message.includes('permitted') })
        ])
        if (!fromPage || !toPage) throw new HttpError(404)
        api.pagetreeId = toPage.pagetree.id
        api.siteId = fromPage.site.id
        api.sitename = fromPage.site.name
        const [fromHTML, toHTML] = await Promise.all([
          renderPage(api, req, res, fromPage, extension, false),
          renderPage(api, req, res, toPage, extension, false)
        ])
        const ret = htmldiff(fromHTML, toHTML)
        return ret.replace(/<\/head>/, '<style>ins { background-color: lightgreen; } del { background-color: pink; }</style></head>')
      }
    )

    /**
     * Route for editing renders - has edit bars, no anonymous access
     */
    this.app.get<{ Params: { '*': string }, Querystring: { token?: string } }>(
      '/.edit/*',
      async (req, res) => {
        const token = getToken(req)
        if (!token) throw new HttpError(401)
        const { path, extension } = parsePath(req.params['*'])
        const api = new this.APIClient<RenderingAPIClient>(false, req)
        api.context = 'edit'
        const page = await api.getPreviewPage(token, path, schemaversion)
        if (!page) throw new HttpError(404)
        api.pagetreeId = page.pagetree.id
        api.siteId = page.site.id
        api.sitename = page.site.name
        return await renderPage(api, req, res, page, extension, true)
      }
    )

    /**
     * Route for fetching CSS and JS from our registered templates, anonymous OK
     */
    this.app.get<{ Params: { version: string, file: string } }>('/.resources/:version/:file', async (req, res) => {
      const [blockName, ...extensionParts] = req.params.file.split('.')
      const extension = extensionParts.join('.')
      const block = extension.includes('css')
        ? templateRegistry.cssblocks.get(blockName)
        : (
            extension.includes('js')
              ? templateRegistry.jsblocks.get(blockName)
              : templateRegistry.files.get(blockName)
          )
      if (!block) throw new HttpError(404)
      void res.header('Cache-Control', 'max-age=31536000, immutable')
      if ('css' in block && extension === 'css') {
        void res.type('text/css')
        void res.header('Content-Length', block.size)
        if (block.map?.length) void res.header('SourceMap', `/.resources/${req.params.version}/${blockName}.css.map`)
        return block.css
      } else if ('js' in block && extension === 'js') {
        void res.type('text/javascript')
        void res.header('Content-Length', block.size)
        if (block.map?.length) void res.header('SourceMap', `/.resources/${req.params.version}/${blockName}.js.map`)
        return block.js
      } else if (extension === 'css.map' && 'map' in block) {
        return block.map ?? ''
      } else if (extension === 'js.map' && 'map' in block) {
        return block.map ?? ''
      } else if (block.path) {
        const fileblock = block as RegistryFile
        const mime = fileblock.mime
        const instream = createReadStream(fileblock.path)
        void res.header('Content-Length', fileblock.size)
        void res.header('Content-Type', mime)
        return await res.send(instream)
      }
      throw new HttpError(404)
    })

    /**
     * Route for serving JS that supports the editing UI
     */
    const editingJs = readFileSync(new URL('./static/editing.js', import.meta.url))
    const editingJsSize = new Blob([editingJs]).size
    this.app.get('/.editing/:version/edit.js', async (req, res) => {
      void res.header('Content-Type', 'application/javascript')
      void res.header('Content-Length', editingJsSize)
      void res.header('Cache-Control', 'max-age=31536000, immutable')
      return editingJs
    })

    /**
     * Route for serving CSS that supports the editing UI
     */
    const editingCss = readFileSync(new URL('./static/editing.css', import.meta.url))
    const editingCssSize = new Blob([editingCss]).size
    this.app.get('/.editing/:version/edit.css', async (req, res) => {
      void res.header('Content-Type', 'text/css')
      void res.header('Content-Length', editingCssSize)
      void res.header('Cache-Control', 'max-age=31536000, immutable')
      return editingCss
    })

    /**
     * Route for serving assets with cookie authentication
     *
     * During editing and previewing, we may have images and links to assets in
     * the page that anonymous users can't see. Especially when editing sandboxes
     * or viewing archives.
     *
     * So downloading assets must be authenticated, but the API only accepts
     * bearer tokens for security reasons. This endpoint is here to translate the
     * render service's cookie into a bearer token for the API and proxy the HTTP
     * response.
     */
    this.app.get<{ Querystring: any, Params: { '*': string } }>('/.asset/*', async (req, res) => {
      const token = getToken(req)
      const query = new URLSearchParams((req.query ?? {}) as Record<string, string>)
      query.set('admin', '1')
      const resp = await download(`${process.env.DOSGATO_API_BASE!}/assets/${encodeURI(req.params['*'])}?${query.toString()}`, token, req.headers)
      for (const h of ['Last-Modified', 'Etag', 'Cache-Control', 'Content-Type', 'Content-Disposition', 'Content-Length', 'Location']) {
        const header = resp.headers[h.toLowerCase()]
        if (header) void res.header(h, header)
      }
      void res.status(resp.statusCode ?? 500)
      return resp
    })
    this.app.get<{ Querystring: any, Params: { '*': string } }>('/.page/*', async (req, res) => {
      const token = getToken(req)
      const query = new URLSearchParams((req.query ?? {}) as Record<string, string>)
      const resp = await download(`${process.env.DOSGATO_API_BASE!}/pages/${encodeURI(req.params['*'])}?${query.toString()}`, token, req.headers)
      for (const h of ['Last-Modified', 'Etag', 'Cache-Control', 'Content-Type', 'Content-Disposition', 'Content-Length', 'Location']) {
        const header = resp.headers[h.toLowerCase()]
        if (header) void res.header(h, header)
      }
      void res.status(resp.statusCode ?? 500)
      return resp
    })

    this.app.get('/favicon.ico', async () => {
      throw new HttpError(404)
    })

    this.app.get('/.token', async (req, res) => {
      return 'OK'
    })

    /**
     * Route to serve launched web pages to anonymous users
     */
    this.app.get<{ Params: { '*': string } }>('*', async (req, res) => {
      const { path, extension } = parsePath(req.params['*'])
      if (path && path !== '/' && !extension) return await res.redirect(`${encodeURI(path)}.html${new URL(req.url, 'http://example.com').search}`, 301)
      const api = new this.APIClient<RenderingAPIClient>(true, req)
      api.context = 'live'
      const pagePath = (path === '/.root') ? '/' : path
      const hostname = req.hostname.replace(/:\d+$/, '')
      let page = await api.getLaunchedPage(hostname, pagePath, schemaversion)
      let usingDefault404 = false
      if (!page) {
        const siteInfo = await api.getSiteInfoByLaunchUrl(`http://${hostname}${pagePath}`)
        if (siteInfo || !((!process.env.DOSGATO_ADMIN_REDIRECT_HOSTNAME || hostname === process.env.DOSGATO_ADMIN_REDIRECT_HOSTNAME) && (path === '' || path === '/'))) {
          void res.status(404)
          if (siteInfo) page = await api.getLaunchedPage(hostname, siteInfo.url.path + '404', schemaversion)
          if (!page && isNotBlank(process.env.DOSGATO_DEFAULT_HOSTNAME)) {
            page = await api.getLaunchedPage(process.env.DOSGATO_DEFAULT_HOSTNAME, '/404', schemaversion)
            usingDefault404 = true
          }
        } else return await res.redirect(process.env.DOSGATO_ADMIN_BASE!, 302)
      }
      if (!page) throw new HttpError(404)
      api.sitePrefix = page.site.url.prefix
      api.pagetreeId = page.pagetree.id
      api.siteId = page.site.id
      // if we don't set a sitename links will always be absolute
      // we want this if we're serving the default hostname's 404 on some other hostname
      // or else relative links will break
      if (!usingDefault404) api.sitename = page.site.name
      return await renderPage(api, req, res, page, extension, false)
    })
  }

  async start (options?: number | { port?: number, templates?: any[], providers?: (typeof ResourceProvider)[], CustomAPIClient?: APIClientClass }) {
    const opts = typeof options === 'number' ? { port: options } : options
    this.APIClient = opts?.CustomAPIClient ?? RenderingAPIClient as APIClientClass
    for (const p of [...(opts?.providers ?? []), ...(opts?.templates ?? [])]) {
      templateRegistry.registerSass(p)
    }
    await Promise.all([
      ...(opts?.providers ?? []).map(async p => await this.addProvider(p)),
      ...(opts?.templates ?? []).map(async t => await this.addTemplate(t))
    ])
    await super.start(opts?.port)
  }

  async addTemplate (template: any) { await templateRegistry.addTemplate(template) }
  async addProvider (template: typeof ResourceProvider) { await templateRegistry.addProvider(template) }
}
