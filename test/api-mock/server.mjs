/**
 * Mock of the DosGato API, implementing just enough of the GraphQL schema for
 * the queries src/api.ts sends (dispatched by operation name) plus the REST
 * download endpoints the /.asset/* and /.page/* proxy routes hit.
 */
import http from 'node:http'
import { assetfolders, assets, datas, pages, sites, templates } from './fixtures.mjs'

function depth (path) {
  return path.split('/').filter(s => s.length).length - 1
}

function shiftPath (path) {
  return '/' + path.split('/').filter(s => s.length).slice(1).join('/')
}

function parentOf (page) {
  const segs = page.path.split('/').filter(s => s.length)
  if (segs.length <= 1) return undefined
  const parentPath = '/' + segs.slice(0, -1).join('/')
  return pages.find(p => p.path === parentPath)
}

function siteInfo (siteId) {
  const site = sites[siteId]
  return { id: site.id, name: site.name, launched: site.launched, url: site.url }
}

function launchedUrlFor (page) {
  const site = sites[page.siteId]
  if (!site.launched || !site.url?.prefix) return undefined
  return site.url.prefix.replace(/\/+$/, '') + shiftPath(page.path)
}

/** Build a PAGE_INFO-shaped object, or undefined when the requested variant doesn't exist. */
function pageOut (page, { published, version } = {}) {
  if (published && !page.publishedAt) return undefined
  const data = version != null
    ? page.versions[version]
    : page.versions[published ? page.publishedVersion : page.latestVersion]
  if (!data) return undefined
  return {
    id: page.id,
    name: page.name,
    linkId: page.linkId,
    path: page.path,
    fallbackTitle: page.title,
    createdAt: page.createdAt,
    modifiedAt: page.modifiedAt,
    publishedAt: page.publishedAt,
    data,
    pagetree: { id: page.pagetreeId },
    site: siteInfo(page.siteId)
  }
}

function filterPages ({ ids, paths, links, pagetreeIds, published }) {
  return pages.filter(p => {
    if (ids && !ids.includes(p.id)) return false
    if (paths && !paths.includes(p.path)) return false
    if (links && !links.some(l => (l.linkId != null && l.linkId === p.linkId) || (l.path != null && l.path === p.path))) return false
    if (pagetreeIds && !pagetreeIds.includes(p.pagetreeId)) return false
    if (published && !p.publishedAt) return false
    return true
  })
}

function dataOut (d) {
  return {
    id: d.id,
    name: d.name,
    data: d.data,
    path: d.path,
    createdAt: d.createdAt,
    publishedAt: d.publishedAt,
    modifiedAt: d.modifiedAt,
    createdBy: { id: 'su01', name: 'Test User' },
    modifiedBy: { id: 'su01', name: 'Test User' },
    site: d.site,
    template: { key: d.templateKey }
  }
}

const operations = {
  getLaunchedPage: vars => {
    // a request for the site root arrives without a trailing slash (http://render)
    const launchUrl = vars.launchUrl.replace(/\/+$/, '')
    const matches = pages.filter(p => launchedUrlFor(p)?.replace(/\/+$/, '') === launchUrl)
    return { pages: matches.map(p => pageOut(p, { published: true })).filter(Boolean) }
  },

  getSiteByLaunchUrl: vars => {
    const launchUrl = vars.launchUrl.replace(/\/+$/, '') + '/'
    const found = Object.values(sites).filter(s => s.launched && s.url?.prefix && launchUrl.startsWith(s.url.prefix))
    return { sites: found.map(s => ({ id: s.id, primaryPagetree: { id: s.primaryPagetreeId }, url: { path: s.url.path, prefix: s.url.prefix } })) }
  },

  getPreviewPage: vars => {
    const matches = pages.filter(p => p.path === vars.path)
    return { pages: matches.map(p => pageOut(p, { published: vars.published, version: vars.version ?? undefined })).filter(Boolean) }
  },

  getPage: vars => {
    return { pages: filterPages(vars).map(p => pageOut(p, { published: vars.published })).filter(Boolean) }
  },

  getAncestorPages: vars => {
    return {
      pages: filterPages(vars).map(p => ({
        id: p.id,
        path: p.path,
        ancestors: pages
          .filter(a => p.path.startsWith(a.path + '/'))
          .map(a => pageOut(a, { published: vars.published }))
          .filter(Boolean)
      }))
    }
  },

  getRootPage: vars => {
    return {
      pages: filterPages(vars).map(p => {
        const rootPath = '/' + p.path.split('/').filter(s => s.length)[0]
        const root = pages.find(r => r.path === rootPath)
        const rootpage = root && pageOut(root, { published: vars.published })
        return rootpage ? { id: p.id, path: p.path, rootpage } : undefined
      }).filter(Boolean)
    }
  },

  getNavigation: vars => {
    const matches = pages.filter(p => {
      if (p.pagetreeId !== vars.pagetreeId) return false
      if (vars.depth != null && depth(p.path) > vars.depth) return false
      if (vars.beneath && !vars.beneath.some(b => b === '/' || p.path.startsWith(b.replace(/\/+$/, '') + '/'))) return false
      if (vars.published && !p.publishedAt) return false
      return true
    })
    return {
      pages: matches.map(p => ({
        id: p.id,
        name: p.name,
        fallbackTitle: p.title,
        path: p.path,
        publishedAt: p.publishedAt,
        site: siteInfo(p.siteId),
        pagetree: { id: p.pagetreeId },
        parent: parentOf(p) ? { id: parentOf(p).id } : null,
        extra: {},
        tags: []
      }))
    }
  },

  getTemplateInfo: () => ({ templates }),

  getDataByPath: vars => {
    const matches = datas.filter(d => d.templateKey === vars.templateKey
      && vars.paths.some(path => d.path === path || d.path.startsWith(path.replace(/\/+$/, '') + '/')))
    return { data: matches.map(dataOut) }
  },

  getDataByLink: vars => {
    const matches = datas.filter(d => vars.links.some(l =>
      l.templateKey === d.templateKey
      && (l.siteId ?? null) === (d.site?.id ?? null)
      && (l.id === d.id || l.path === d.path)
    ))
    return { data: matches.map(dataOut) }
  },

  getDataFolderByLink: () => ({ datafolders: [] }),

  // Three distinct queries share this operation name in src/api.ts: by links,
  // by parentPaths, and by beneath. Distinguish them by their inputs.
  getAssetByLink: (vars, query) => {
    if (vars.links) {
      const matches = assets.filter(a => vars.links.some(l =>
        (l.linkId != null && l.linkId === a.linkId)
        || (l.path != null && l.path === a.path)
        || (l.checksum != null && l.checksum === a.checksum)
      ))
      return { assets: matches }
    }
    const recursive = query.includes('beneath')
    const matches = assets.filter(a => vars.paths.some(path => {
      const clean = path.replace(/\/+$/, '')
      if (recursive) return a.path.startsWith(clean + '/')
      return a.path.split('/').slice(0, -1).join('/') === clean
    }))
    return { assets: matches }
  },

  getAssetsByFolderLink: vars => {
    const matches = assetfolders.filter(f => vars.links.some(l =>
      (l.linkId != null && l.linkId === f.linkId) || (l.path != null && l.path === f.path)
    ))
    return { assetfolders: matches }
  },

  identifyToken: () => ({ users: [{ id: 'su01' }] })
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url, 'http://api-mock')
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('OK')
      return
    }
    if (req.method === 'POST' && url.pathname === '/graphql') {
      const { query, variables } = JSON.parse(await readBody(req))
      const opName = /query\s+(\w+)/.exec(query)?.[1]
      const handler = operations[opName]
      let body
      if (handler) {
        body = { data: handler(variables ?? {}, query) }
      } else {
        console.error('unhandled graphql operation:', opName, query)
        body = { errors: [{ message: `mock api does not implement operation ${opName}` }] }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
      return
    }
    // download endpoint proxied by the render server's /.asset/* route
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const id = url.pathname.split('/')[2]
      const asset = assets.find(a => a.id === id)
      if (!asset) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('asset not found')
        return
      }
      const body = `MOCKBYTES:${asset.id}`
      res.writeHead(200, {
        'Content-Type': asset.mime,
        'Content-Length': Buffer.byteLength(body),
        'Content-Disposition': `attachment; filename="${asset.filename}"`
      })
      res.end(body)
      return
    }
    // download endpoint proxied by the render server's /.page/* route
    if (req.method === 'GET' && url.pathname.startsWith('/pages/')) {
      const body = JSON.stringify({ ok: true, path: url.pathname, query: Object.fromEntries(url.searchParams) })
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
      res.end(body)
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  })().catch(e => {
    console.error(e)
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end(String(e))
  })
})

server.listen(80, () => console.info('mock dosgato api listening on port 80'))
