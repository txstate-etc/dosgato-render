import { Component, ResourceProvider, PageRecord, Page, ComponentData, PageData } from '@dosgato/templating'
import { FastifyRequest } from 'fastify'
import cookie from 'fastify-cookie'
import Server, { FastifyTxStateOptions, HttpError } from 'fastify-txstate'
import { createReadStream } from 'fs'
import { api } from './api'
import { templateRegistry } from './registry'
import { renderPage } from './render'
import { parsePath } from './util'
import { schemaversion } from './version'

function getToken (req: FastifyRequest<{ Querystring: { token?: string }}>) {
  const header = req.headers.authorization?.split(' ') ?? ['Bearer', '']
  if (header[0] === 'Bearer') return header[1]
  return req.query?.token ?? req.cookies.token ?? ''
}

export class RenderingServer extends Server {
  constructor (config?: FastifyTxStateOptions) {
    super(config)
    void this.app.register(cookie)

    /**
     * Route for preview renders - no edit bars, anonymous access only when
     * :version is 'public'
     */
    this.app.get<{ Params: { '*': string, pagetreeId: string, version: string }, Querystring: { token?: string } }>(
      '/.preview/:pagetreeId/:version/*',
      async req => {
        const { path, extension } = parsePath(req.params['*'])
        const published = req.params.version === 'public' ? true : undefined
        const version = published ? undefined : (parseInt(req.params.version) || undefined)
        const page = await api.getPreviewPage(getToken(req), req.params.pagetreeId, path, schemaversion, published, version)
        if (!page) throw new HttpError(404)
        return await renderPage(req.headers, page, extension, false)
      }
    )

    /**
     * Route for editing renders - has edit bars, no anonymous access
     */
    this.app.get<{ Params: { '*': string, pagetreeId: string, version: string }, Querystring: { token?: string } }>(
      '/.edit/:pagetreeId/*',
      async req => {
        const { path, extension } = parsePath(req.params['*'])
        if (extension && extension !== 'html') throw new HttpError(400, 'Only the html version of a page can be edited.')
        const page = await api.getPreviewPage(getToken(req), req.params.pagetreeId, path, schemaversion)
        if (!page) throw new HttpError(404)
        return await renderPage(req.headers, page, extension, true)
      }
    )

    /**
     * Route to serve launched web pages to anonymous users
     */
    this.app.get<{ Params: { '*': string } }>('*', async (req, res) => {
      const { path, extension } = parsePath(req.params['*'])
      if (!extension) return await res.redirect(301, `${path}.html`)
      const page = await api.getLaunchedPage(req.hostname, path, schemaversion)
      if (!page) throw new HttpError(404)
      return await renderPage(req.headers, page, extension, false)
    })

    /**
     * Route for fetching CSS and JS from our registered templates, anonymous OK
     */
    this.app.get<{ Params: { '*': string, version: string, file: string } }>('/.resources/:version/:file', async (req, res) => {
      const [blockName, extension] = req.params.file.split('.', 2)
      const block = extension.includes('css')
        ? templateRegistry.cssblocks.get(blockName)
        : (
            extension.includes('js')
              ? templateRegistry.jsblocks.get(blockName)
              : templateRegistry.files.get(blockName)
          )
      if (!block) throw new HttpError(404)
      await res.header('Cache-Control', 'max-age=31536000, immutable')
      if ('css' in block && extension === 'css') {
        await res.type('text/css')
        if ((block.map?.length ?? 0) > 0) await res.header('SourceMap', `/.resources/${req.params.version}/${blockName}.css.map`)
        return block.css
      } else if ('js' in block && extension === 'js') {
        await res.type('text/javascript')
        if ((block.map?.length ?? 0) > 0) await res.header('SourceMap', `/.resources/${req.params.version}/${blockName}.js.map`)
        return block.js
      } else if (extension === 'css.map' && 'map' in block) {
        return block.map ?? ''
      } else if (extension === 'js.map' && 'map' in block) {
        return block.map ?? ''
      } else if (block.path && 'mime' in block) {
        const instream = createReadStream(block.path)
        await res.header('Content-Length', block.length)
        await res.header('Content-Type', block.mime)
        return await res.send(instream)
      }
      throw new HttpError(404)
    })
  }

  addTemplate<T extends typeof Component>(template: T) { templateRegistry.addTemplate(template) }
  addProvider<T extends typeof ResourceProvider>(template: T) { templateRegistry.addProvider(template) }
}
