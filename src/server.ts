import { ResourceProvider } from '@dosgato/templating'
import { FastifyRequest } from 'fastify'
import Server, { FastifyTxStateOptions, HttpError } from 'fastify-txstate'
import { createReadStream, readFileSync } from 'fs'
import { decodeJwt, jwtVerify, SignJWT } from 'jose'
import { Cache } from 'txstate-utils'
import { api, type APIClient } from './api.js'
import { templateRegistry } from './registry.js'
import { renderPage } from './render.js'
import { jwtSignKey, parsePath } from './util.js'
import { schemaversion } from './version.js'

const resignedCache = new Cache(async ({ token, path }: { token: string, path?: string }) => {
  try {
    const payload = decodeJwt(token)
    if (payload.iss === 'dg-render-temporary') {
      if (!await jwtVerify(token, jwtSignKey)) throw new HttpError(401)
      if (path !== payload.path) throw new HttpError(403)
      token = await new SignJWT({ sub: payload.sub })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('dg-render')
        .setExpirationTime('15 minute')
        .sign(jwtSignKey)
    }
    return token
  } catch (e: any) {
    throw new HttpError(401)
  }
})

const tempTokenCache = new Cache(async ({ token, path }: { token: string, path: string }, api: APIClient) => {
  const sub = await api.identifyToken(token)
  if (!sub) throw new HttpError(401)
  return await new SignJWT({ sub, path })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('dg-render-temporary')
    .setExpirationTime('2 hour')
    .sign(jwtSignKey)
}, {
  freshseconds: 1800
})

function getToken (req: FastifyRequest<{ Querystring: { token?: string } }>) {
  const header = req.headers.authorization?.split(' ') ?? []
  if (header[0] === 'Bearer') return header[1]
  return req.query?.token ?? ''
}

async function resignToken (token: string, allowEmptyToken?: boolean, path?: string) {
  if (!token && !allowEmptyToken) throw new HttpError(401)
  return await resignedCache.get({ token, path })
}

export class RenderingServer extends Server {
  private api: APIClient = api

  constructor (config?: FastifyTxStateOptions) {
    super(config)

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
        const token = await resignToken(getToken(req), published, path)
        const page = await this.api.getPreviewPage(token, req.params.pagetreeId, path, schemaversion, published, version)
        if (!page) throw new HttpError(404)
        void res.header('Content-Type', 'text/html')
        return await renderPage(req.headers, page, extension, false)
      }
    )

    /**
     * Route for editing renders - has edit bars, no anonymous access
     */
    this.app.get<{ Params: { '*': string, pagetreeId: string, version: string }, Querystring: { token?: string } }>(
      '/.edit/:pagetreeId/*',
      async (req, res) => {
        const { path, extension } = parsePath(req.params['*'])
        if (extension && extension !== 'html') throw new HttpError(400, 'Only the html version of a page can be edited.')
        const token = await resignToken(getToken(req), undefined, path)
        const page = await this.api.getPreviewPage(token, req.params.pagetreeId, path, schemaversion)
        if (!page) throw new HttpError(404)
        void res.header('Content-Type', 'text/html')
        return await renderPage(req.headers, page, extension, true)
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
    this.app.get<{ Params: { '*': string } }>('/token/*', async (req, res) => {
      const token = getToken(req as any)
      const { path } = parsePath(req.params['*'])
      if (!path) throw new HttpError(400, 'Must specify a path to get a temporary token.')
      return await tempTokenCache.get({ token, path }, this.api)
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
        if ((block.map?.length ?? 0) > 0) void res.header('SourceMap', `/.resources/${req.params.version}/${blockName}.css.map`)
        return block.css
      } else if ('js' in block && extension === 'js') {
        void res.type('text/javascript')
        if ((block.map?.length ?? 0) > 0) void res.header('SourceMap', `/.resources/${req.params.version}/${blockName}.js.map`)
        return block.js
      } else if (extension === 'css.map' && 'map' in block) {
        return block.map ?? ''
      } else if (extension === 'js.map' && 'map' in block) {
        return block.map ?? ''
      } else if (block.path && 'mime' in block) {
        const instream = createReadStream(block.path)
        void res.header('Content-Length', block.length)
        void res.header('Content-Type', block.mime)
        return await res.send(instream)
      }
      throw new HttpError(404)
    })

    /**
     * Route for serving JS that supports the editing UI
     */
    const editingJs = readFileSync('./editing.js')
    this.app.get('/.editing/edit.js', async (req, res) => {
      void res.header('Content-Type', 'application/javascript')
      return editingJs
    })

    /**
     * Route for serving CSS that supports the editing UI
     */
    const editingCss = readFileSync('./editing.css')
    this.app.get('/.editing/edit.css', async (req, res) => {
      void res.header('Content-Type', 'text/css')
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
      if (!path || path === '/') throw new HttpError(404)
      if (!extension) return await res.redirect(301, `${path}.html`)
      const page = await this.api.getLaunchedPage(req.hostname, path, schemaversion)
      if (!page) throw new HttpError(404)
      void res.type('text/html')
      return await renderPage(req.headers, page, extension, false)
    })
  }

  async start (options?: number|{ port?: number, templates?: any[], providers?: (typeof ResourceProvider)[], api?: APIClient }) {
    const opts = typeof options === 'number' ? { port: options } : options
    if (opts?.api) this.api = opts?.api
    await Promise.all([
      ...(opts?.templates ?? []).map(async t => await this.addTemplate(t)),
      ...(opts?.providers ?? []).map(async p => await this.addProvider(p))
    ])
    return await super.start(opts?.port)
  }

  async addTemplate (template: any) { await templateRegistry.addTemplate(template) }
  async addProvider (template: typeof ResourceProvider) { await templateRegistry.addProvider(template) }
}
