import { type APIClient, ResourceProvider } from '@dosgato/templating'
import cookie from '@fastify/cookie'
import { Blob } from 'buffer'
import { FastifyRequest } from 'fastify'
import Server, { FastifyTxStateOptions, HttpError } from 'fastify-txstate'
import { fileTypeFromFile } from 'file-type'
import { createReadStream, readFileSync } from 'fs'
import htmldiff from 'node-htmldiff'
import { decodeJwt, jwtVerify, SignJWT } from 'jose'
import { Cache, rescue } from 'txstate-utils'
import { RenderingAPIClient } from './api.js'
import { RegistryFile, templateRegistry } from './registry.js'
import { renderPage } from './render.js'
import { jwtSignKey, parsePath } from './util.js'
import { schemaversion } from './version.js'

const resignedCache = new Cache(async ({ token, path }: { token: string, path?: string }) => {
  try {
    const payload = decodeJwt(token)
    if (payload.iss === 'dg-render-temporary') {
      try {
        if (!await jwtVerify(token, jwtSignKey)) throw new HttpError(401)
      } catch {
        throw new HttpError(401)
      }
      if (path !== payload.path) throw new HttpError(403)
      token = await new SignJWT({ sub: payload.sub })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('dg-render')
        .setExpirationTime('2 hour')
        .sign(jwtSignKey)
    }
    return token
  } catch (e: any) {
    throw new HttpError(401)
  }
}, { freshseconds: 1800 })

const anonAPIClient = new RenderingAPIClient(true)
const tempTokenCache = new Cache(async ({ token, path, currentToken }: { token: string, path: string, currentToken?: string }) => {
  const sub = await anonAPIClient.identifyToken(token)
  if (!sub) throw new HttpError(401)
  if (currentToken && await rescue(jwtVerify(currentToken, jwtSignKey), false)) {
    return currentToken
  }
  return await new SignJWT({ sub, path })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('dg-render-temporary')
    .setExpirationTime('1 hour')
    .sign(jwtSignKey)
}, { freshseconds: 1800 })

function getToken (req: FastifyRequest<{ Querystring: { token?: string } }>) {
  const header = req.headers.authorization?.split(' ') ?? []
  if (header[0] === 'Bearer') return header[1]
  return req.query?.token ?? req.cookies.dg_token ?? ''
}

async function resignToken (token: string, allowEmptyToken?: boolean, path?: string) {
  if (!token && !allowEmptyToken) throw new HttpError(401)
  return await resignedCache.get({ token, path })
}

type APIClientClass = new <T extends APIClient> (published: boolean, token: string | undefined, req: FastifyRequest) => T

export class RenderingServer extends Server {
  private APIClient!: APIClientClass

  constructor (config?: FastifyTxStateOptions) {
    const existingCheckOrigin = config?.checkOrigin
    config ??= {}
    config.checkOrigin = (req: FastifyRequest) => {
      if (existingCheckOrigin?.(req)) return true
      if (req.routerPath === '/.editing/:version/edit.js' || req.routerPath === '/.edit/:pagetreeId/*') return true
      if (req.routerPath === '/.resources/:version/:file') {
        return req.headers.origin === 'null'
      }
      return false
    }
    super(config)

    void this.app.register(cookie)

    /**
     * Route for preview renders - no edit bars, anonymous access only when
     * :version is 'public'
     */
    this.app.get<{ Params: { '*': string, pagetreeId: string, version: string }, Querystring: { token?: string } }>(
      '/.preview/:pagetreeId/:version/*',
      async (req, res) => {
        const { path, extension } = parsePath(req.params['*'])
        const published = req.params.version === 'public' ? true : undefined
        const version = published ? undefined : (parseInt(req.params.version) || undefined)
        let token: string
        try {
          token = await resignToken(getToken(req), published, path)
        } catch (e: any) {
          if (e instanceof HttpError && e.statusCode === 401) {
            void res.redirect(302, `${process.env.DOSGATO_ADMIN_BASE!}/preview?url=${encodeURIComponent(`${req.protocol}://${req.hostname}${req.url}`)}`)
            return
          } else {
            throw e
          }
        }
        if (req.query.token) {
          void res.setCookie('dg_token', req.query.token, { httpOnly: true, sameSite: 'strict', path: '/.preview/' })
          const withoutToken = new URL(req.url, `${req.protocol}://${req.hostname}`)
          withoutToken.searchParams.delete('token')
          void res.redirect(302, withoutToken.toString())
          return
        }
        const api = new this.APIClient<RenderingAPIClient>(!!published, token, req)
        api.context = 'preview'
        api.pagetreeId = req.params.pagetreeId
        const page = await rescue(api.getPreviewPage(req.params.pagetreeId, path, schemaversion, published, version), { condition: e => e.message.includes('permitted') })
        if (!page) throw new HttpError(404)
        api.sitename = page.site.name
        return await renderPage(api, req, res, page, extension, false)
      }
    )

    /**
     * Route for a diff render that compares two versions
     */
    this.app.get<{ Params: { '*': string, pagetreeId: string, fromVersion: string, toVersion: string }, Querystring: { token?: string } }>(
      '/.compare/:pagetreeId/:fromVersion/:toVersion/*',
      async (req, res) => {
        const { path, extension } = parsePath(req.params['*'])
        const token = await resignToken(getToken(req), false, path)
        if (req.query.token) {
          void res.setCookie('dg_token', req.query.token, { httpOnly: true, sameSite: 'strict', path: '/.compare/' })
          const withoutToken = new URL(req.url, `${req.protocol}://${req.hostname}`)
          withoutToken.searchParams.delete('token')
          void res.redirect(302, withoutToken.toString())
          return
        }
        const api = new this.APIClient<RenderingAPIClient>(false, token, req)
        api.context = 'preview'
        api.pagetreeId = req.params.pagetreeId
        const [fromPage, toPage] = await Promise.all([
          rescue(api.getPreviewPage(req.params.pagetreeId, path, schemaversion, undefined, parseInt(req.params.fromVersion)), { condition: e => e.message.includes('permitted') }),
          rescue(api.getPreviewPage(req.params.pagetreeId, path, schemaversion, undefined, parseInt(req.params.toVersion)), { condition: e => e.message.includes('permitted') })
        ])
        if (!fromPage || !toPage) throw new HttpError(404)
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
    this.app.get<{ Params: { '*': string, pagetreeId: string, version: string }, Querystring: { token?: string } }>(
      '/.edit/:pagetreeId/*',
      async (req, res) => {
        const { path, extension } = parsePath(req.params['*'])
        const token = await resignToken(getToken(req), undefined, path)
        const api = new this.APIClient<RenderingAPIClient>(false, token, req)
        api.context = 'edit'
        api.pagetreeId = req.params.pagetreeId
        const page = await api.getPreviewPage(req.params.pagetreeId, path, schemaversion)
        api.sitename = page.site.name
        if (!page) throw new HttpError(404)
        return await renderPage(api, req, res, page, extension, true)
      }
    )

    /**
     * Acquire a token for use by the editing iframe in the admin UI
     *
     * When an editor is editing a page, they load an iframe pointing at the rendering service
     * at /.edit/path, but their auth token in the admin UI is in session storage, not a cookie,
     * so we need to send the token as a query parameter. However, if we simply send the editor's
     * API token, other editors could write custom javascript to collect their API token just by
     * opening the other editor's page.
     *
     * Additionally, we cannot set sandbox="allow-same-origin" on the iframe, or else custom
     * javascript could read the token out of session storage. This means cookies will not work
     * either, because without "allow-same-origin" the browser treats the iframe as cross domain
     * in all respects, including cookies.
     *
     * To solve all these problems, we will make a request from the admin UI to this endpoint
     * with the auth token as a Bearer token, prior to loading the iframe onto the page. This
     * endpoint will return a temporary token issued by the rendering server, which can be sent
     * to the /.edit/ endpoint as a query parameter. The temporary token will be short-lived,
     * locked down to a single path, and only useful to view the latest version of the page. This
     * vastly limits the damage if an editor writes custom js to collect it.
     */
    this.app.get<{ Params: { '*': string }, Querystring: { currentToken?: string } }>('/.token/*', async (req, res) => {
      const token = getToken(req as any)
      const { path } = parsePath(req.params['*'])
      if (!path) throw new HttpError(400, 'Must specify a path to get a temporary token.')
      return await tempTokenCache.get({ token, path, currentToken: req.query.currentToken })
    })

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
      const page = await api.getLaunchedPage(req.hostname, path, schemaversion)
      if (!page) {
        if (path && path !== '/') throw new HttpError(404)
        else return await res.redirect(302, process.env.DOSGATO_ADMIN_BASE!)
      }
      api.sitePrefix = page.site.url.prefix
      return await renderPage(anonAPIClient, req, res, page, extension, false)
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
