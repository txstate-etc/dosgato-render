import { type APIClient, type ResourceProvider } from '@dosgato/templating'
import cookie from '@fastify/cookie'
import { Blob } from 'node:buffer'
import { type FastifyRequest } from 'fastify'
import Server, { type FastifyTxStateOptions, HttpError } from 'fastify-txstate'
import { fileTypeFromFile } from 'file-type'
import { createReadStream, readFileSync } from 'node:fs'
import htmldiff from 'node-htmldiff'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { isNotBlank, rescue } from 'txstate-utils'
import { RenderingAPIClient } from './api.js'
import { type RegistryFile, templateRegistry } from './registry.js'
import { renderPage } from './render.js'
import { parsePath } from './util.js'
import { schemaversion } from './version.js'

function getToken (req: FastifyRequest<{ Querystring: { token?: string } }>) {
  const header = req.headers.authorization?.split(' ') ?? []
  if (header[0] === 'Bearer') return header[1]
  return req.cookies.dg_token
}

type APIClientClass = new <T extends APIClient> (published: boolean, token: string | undefined, req: FastifyRequest) => T

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
    super(config)

    void this.app.register(cookie)
    this.app.addHook('preHandler', async (req, res) => {
      const token: string | undefined = (req as any).query?.token
      if (token) {
        void res.setCookie('dg_token', token, { httpOnly: true, sameSite: 'strict', path: '/.edit/' })
        void res.setCookie('dg_token', token, { httpOnly: true, sameSite: 'strict', path: '/.preview/' })
        void res.setCookie('dg_token', token, { httpOnly: true, sameSite: 'strict', path: '/.compare/' })
        void res.setCookie('dg_token', token, { httpOnly: true, sameSite: 'strict', path: '/.asset/' })
        const withoutToken = new URL(req.url, `${req.protocol}://${req.hostname}`)
        withoutToken.searchParams.delete('token')
        void res.redirect(302, withoutToken.toString())
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
        const version = published ? undefined : (parseInt(req.params.version) || undefined)
        const token = getToken(req)
        if (!token && !published) void res.redirect(302, `${process.env.DOSGATO_ADMIN_BASE!}/preview?url=${encodeURIComponent(`${req.protocol}://${req.hostname}${req.url}`)}`)
        const api = new this.APIClient<RenderingAPIClient>(!!published, token, req)
        api.context = 'preview'
        const page = await rescue(api.getPreviewPage(path, schemaversion, published, version), { condition: e => e.message.includes('permitted') })
        if (!page) throw new HttpError(404)
        api.pagetreeId = page.pagetree.id
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
        if (!token) void res.redirect(302, `${process.env.DOSGATO_ADMIN_BASE!}/preview?url=${encodeURIComponent(`${req.protocol}://${req.hostname}${req.url}`)}`)
        const api = new this.APIClient<RenderingAPIClient>(false, token, req)
        api.context = 'preview'
        const [fromPage, toPage] = await Promise.all([
          rescue(api.getPreviewPage(path, schemaversion, undefined, parseInt(req.params.fromVersion)), { condition: e => e.message.includes('permitted') }),
          rescue(api.getPreviewPage(path, schemaversion, undefined, parseInt(req.params.toVersion)), { condition: e => e.message.includes('permitted') })
        ])
        if (!fromPage || !toPage) throw new HttpError(404)
        api.pagetreeId = toPage.pagetree.id
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
        const api = new this.APIClient<RenderingAPIClient>(false, token, req)
        api.context = 'edit'
        const page = await api.getPreviewPage(path, schemaversion)
        if (!page) throw new HttpError(404)
        api.pagetreeId = page.pagetree.id
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
        const mime = fileblock.mime ?? await fileTypeFromFile(fileblock.path)
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
      const resp = await fetch(`${process.env.DOSGATO_API_BASE!}/assets/${encodeURI(req.params['*'])}?${query.toString()}`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : ''
        }
      })
      for (const h of ['Last-Modified', 'ETag', 'Cache-Control', 'Content-Type', 'Content-Disposition', 'Content-Length', 'Location']) {
        void res.header(h, resp.headers.get(h))
      }
      void res.status(resp.status)
      return resp.status >= 400 ? await resp.text() : Readable.fromWeb(resp.body as ReadableStream)
    })

    this.app.get('/favicon.ico', async () => {
      throw new HttpError(404)
    })

    /**
     * Route to serve launched web pages to anonymous users
     */
    this.app.get<{ Params: { '*': string } }>('*', async (req, res) => {
      const { path, extension } = parsePath(req.params['*'])
      if (path && path !== '/' && !extension) return await res.redirect(301, `${path}.html`)
      const api = new this.APIClient<RenderingAPIClient>(true, undefined, req)
      api.context = 'live'
      const pagePath = (path === '/.root') ? '/' : path
      let page = await api.getLaunchedPage(req.hostname.replace(/:\d+$/, ''), pagePath, schemaversion)
      if (page) {
        api.sitePrefix = page.site.url.prefix
        api.pagetreeId = page.pagetree.id
      }
      if (!page) {
        if (path && path !== '/') {
          void res.status(404)
          const siteInfo = await api.getSiteInfoByLaunchUrl(`http://${req.hostname.replace(/:\d+$/, '')}${pagePath}`)
          if (siteInfo) {
            // we may be rendering the 404 from another site, but we want to render it as if it were part of
            // the originally requested site, so we use the siteInfo that we gathered about our originally requested site.
            api.sitePrefix = siteInfo.url.prefix
            api.pagetreeId = siteInfo.pagetree.id
            page = await api.getLaunchedPage(req.hostname.replace(/:\d+$/, ''), siteInfo.url.path + '404', schemaversion)
            if (!page && isNotBlank(process.env.DOSGATO_DEFAULT_HOSTNAME)) page = await api.getLaunchedPage(process.env.DOSGATO_DEFAULT_HOSTNAME!, '/404', schemaversion)
          }
        } else return await res.redirect(302, process.env.DOSGATO_ADMIN_BASE!)
      }
      if (!page) throw new HttpError(404)
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
