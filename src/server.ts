import { ResourceProvider } from '@dosgato/templating'
import { FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import Server, { FastifyTxStateOptions, HttpError } from 'fastify-txstate'
import { createReadStream } from 'fs'
import { api, type APIClient } from './api.js'
import { templateRegistry } from './registry.js'
import { renderPage } from './render.js'
import { parsePath } from './util.js'
import { schemaversion } from './version.js'

function getToken (req: FastifyRequest<{ Querystring: { token?: string }}>) {
  const header = req.headers.authorization?.split(' ') ?? []
  if (header[0] === 'Bearer') return header[1]
  return req.query?.token ?? req.cookies.token ?? ''
}

export class RenderingServer extends Server {
  private api: APIClient = api

  constructor (config?: FastifyTxStateOptions) {
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
        const page = await this.api.getPreviewPage(getToken(req), req.params.pagetreeId, path, schemaversion, published, version)
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
        const page = await this.api.getPreviewPage(getToken(req), req.params.pagetreeId, path, schemaversion)
        if (!page) throw new HttpError(404)
        void res.header('Content-Type', 'text/html')
        return await renderPage(req.headers, page, extension, true)
      }
    )

    /**
     * Route for fetching CSS and JS from our registered templates, anonymous OK
     */
    this.app.get<{ Params: { '*': string, version: string, file: string } }>('/.resources/:version/:file', async (req, res) => {
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
    this.app.get('/.editing/edit.js', async (req, res) => {
      void res.header('Content-Type', 'application/javascript')
      return `
        window.dgEditing = {
          path (el) {
            return el.closest('[data-path]').getAttribute('data-path')
          },
          send (action, e) {
            const path = this.path(e.target)
            window.top.postMessage({ action, path }, '*')
          },
          edit (e) {
            this.send('edit', e)
          },
          move (e) {
            this.send('move', e)
          },
          del (e) {
            this.send('del', e)
          },
          barPath (bar) {
            return bar.getAttribute('data-path')
          },
          drag (e) {
            this.validdrops = new Set()
            const path = this.path(e.target)
            this.dragging = path
            const editbars = Array.from(document.querySelectorAll('.dg-edit-bar'))
            const allpaths = editbars.map(this.barPath)
            window.top.postMessage({ action: 'drag', path, allpaths }, '*')
          },
          drop (e) {
            this.send('drop', e)
            const path = this.path(e.target)
            if (this.validdrops.has(path)) e.preventDefault()
          },
          over (e) {
            const path = this.path(e.target)
            if (this.validdrops.has(path)) e.preventDefault()
          },
          message (e) {
            if (e.data.action === 'drag') {
              this.validdrops = e.data.validdrops
            }
          }
        }
        window.addEventListener('message', window.dgEditing.message)
      `
    })

    /**
     * Route for serving CSS that supports the editing UI
     */
    this.app.get('/.editing/edit.css', async (req, res) => {
      void res.header('Content-Type', 'text/css')
      return `
        .dg-edit-bar {
          background-color: rgba(235,232,232,0.59);
          border: 2px solid #BC8CBF;
          display: flex;
          justify-content: flex-end;
          align-items: center;
        }
        .dg-edit-bar.selected {
          background-color: #BC8CBF;
        }
      `
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
