import { type APIClient, type AssetFolderLink, type AssetLink, type AssetRecord, type DataData, type DataFolderLink, type DataLink, extractLinksFromText, type LinkDefinition, type PageData, type PageForNavigation, type PageLink, type PageLinkWithContext, type PageRecord, type PictureAttributes, type SiteInfo, type DataRecord } from '@dosgato/templating'
import { BestMatchLoader, DataLoaderFactory, ManyJoinedLoader, OneToManyLoader, PrimaryKeyLoader } from 'dataloader-factory'
import type { FastifyRequest } from 'fastify'
import { SignJWT } from 'jose'
import { Cache, ensureString, groupby, isBlank, keyby, pick, stringify, titleCase, toArray } from 'txstate-utils'
import { jwtSignKey, resolvePath, shiftPath } from './util.js'
import { schemaversion } from './version.js'
import { HttpError } from 'fastify-txstate'
import { type IncomingMessage, get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import HttpAgent, { HttpsAgent } from 'agentkeepalive'

const SITE_INFO = 'site { id name launched url { path prefix } }'

const PAGE_INFO = `
id
name
linkId
path
fallbackTitle
createdAt
modifiedAt
publishedAt
data (schemaversion: $schemaversion, published: $published)
pagetree { id }
${SITE_INFO}
`

const PAGE_INFO_VERSION = `
id
name
linkId
path
fallbackTitle
createdAt
modifiedAt
publishedAt
pagetree { id }
data (schemaversion: $schemaversion, published: $published, version: $version)
${SITE_INFO}
`
const PAGE_INFO_NODATA = `
id
name
linkId
path
fallbackTitle
createdAt
modifiedAt
publishedAt
pagetree { id }
${SITE_INFO}
`

const LAUNCHED_PAGE_QUERY = `
query getLaunchedPage ($launchUrl: String!, $schemaversion: DateTime!, $published: Boolean) {
  pages (filter: { launchedUrls: [$launchUrl], published: true }) {
    ${PAGE_INFO}
  }
}
`

const PREVIEW_PAGE_QUERY = `
query getPreviewPage ($schemaversion: DateTime!, $path: UrlSafePath!, $published: Boolean, $version: Int) {
  pages (filter: { paths: [$path] }) {
    ${PAGE_INFO_VERSION}
  }
}
`

const anonToken = await new SignJWT({ sub: 'anonymous' })
  .setIssuer('dg-render')
  .setProtectedHeader({ alg: 'HS256' })
  .sign(jwtSignKey)

function matchAssetPath (link: AssetLink | AssetFolderLink, asset: { path: string, site: { id: string, name: string } }) {
  if (link.path === asset.path) return true
  return link.siteId && link.siteId === asset.site.id && link.path?.split('/').slice(2).join('/') === asset.path.split('/').slice(2).join('/')
}

export interface FetchedAsset {
  id: string
  linkId: string
  path: string
  checksum: string
  name: string
  extension: string
  filename: string
  mime: string
  size: number
  data: any
  resizes: {
    id: string
    width: number
    height: number
    mime: string
  }[]
  box?: {
    width: number
    height: number
  }
  site: {
    id: string
    name: string
  }
}

const assetDetails = 'id linkId path checksum name extension filename mime size data resizes { id width height mime } box { width height } site { id name }'

const assetByLinkLoader = new BestMatchLoader({
  fetch: async (links: AssetLink[], api: RenderingAPIClient) => {
    const { assets } = await api.query<{ assets: FetchedAsset[] }>(
      `query getAssetByLink ($links: [AssetLinkInput!]!) { assets (filter: { links: $links }) { ${assetDetails} } }`
      , { links: links.map(l => ({ ...pick(l, 'path', 'checksum', 'siteId'), linkId: l.id, context: { pagetreeId: api.pagetreeId } })) })
    return assets
  },
  scoreMatch: (link, asset) => asset.linkId === link.id ? 3 : (matchAssetPath(link, asset) ? 2 : (asset.checksum === link.checksum ? 1 : 0))
})

const assetsByFolderPathLoader = new ManyJoinedLoader({
  fetch: async (paths: string[], filters: { recursive?: boolean }, api: RenderingAPIClient) => {
    const query = filters.recursive
      ? `query getAssetByLink ($paths: [UrlSafePath!]!) { assets (filter: { beneath: $paths }) { ${assetDetails} } }`
      : `query getAssetByLink ($paths: [UrlSafePath!]!) { assets (filter: { parentPaths: $paths }) { ${assetDetails} } }`
    const { assets } = await api.query<{ assets: FetchedAsset[] }>(
      query
      , { paths })
    if (filters.recursive) return paths.flatMap(path => assets.filter(a => a.path.startsWith(path)).map(a => ({ key: path, value: a })))
    else {
      const assetsPlusFolderPath = assets.map(a => ({ ...a, folderPath: a.path.split('/').slice(0, -1).join('/') }))
      return paths.flatMap(path => assetsPlusFolderPath.filter(a => a.folderPath === path).map(a => ({ key: path, value: a })))
    }
  }
})

const assetfoldersByLinkLoader = new BestMatchLoader({
  fetch: async (links: AssetFolderLink[], api: RenderingAPIClient) => {
    const { assetfolders } = await api.query<{ assetfolders: { id: string, path: string, site: { id: string, name: string } }[] }>(
      'query getAssetsByFolderLink ($links: [AssetFolderLinkInput!]!) { assetfolders (filter: { links: $links }) { id path site { id name } } }'
      , { links: links.map(l => ({ ...pick(l, 'path', 'siteId'), linkId: l.id, context: { pagetreeId: api.pagetreeId } })) })
    return assetfolders
  },
  scoreMatch: (link, folder) => folder.id === link.id ? 2 : (matchAssetPath(link, folder) ? 1 : 0)
})

const ANCESTOR_QUERY = `
query getAncestorPages ($ids: [ID!], $paths: [UrlSafePath!], $schemaversion: DateTime!, $published: Boolean) {
  pages (filter: { ids: $ids, paths: $paths }) {
    id
    path
    ancestors {
      ${PAGE_INFO}
    }
  }
}`
interface PageWithAncestors {
  id: string
  path: string
  ancestors: PageRecord<PageData>[]
}
const ancestorsByIdLoader = new PrimaryKeyLoader({
  fetch: async (ids: string[], api: RenderingAPIClient) => {
    const { pages } = await api.query<{ pages: PageWithAncestors[] }>(ANCESTOR_QUERY, { ids, schemaversion, published: api.published })
    return pages
  },
  extractId: (pageWithAncestors) => pageWithAncestors.id
})
const ancestorsByPathLoader = new PrimaryKeyLoader({
  fetch: async (paths: string[], api: RenderingAPIClient) => {
    const { pages } = await api.query<{ pages: PageWithAncestors[] }>(ANCESTOR_QUERY, { paths, schemaversion, published: api.published })
    return pages
  },
  extractId: (pageWithAncestors) => pageWithAncestors.path,
  idLoader: ancestorsByIdLoader
})
ancestorsByIdLoader.addIdLoader(ancestorsByPathLoader)

const ROOTPAGE_QUERY = `
query getRootPage ($ids: [ID!], $paths: [UrlSafePath!], $schemaversion: DateTime!, $published: Boolean) {
  pages (filter: { ids: $ids, paths: $paths }) {
    id
    path
    rootpage {
      ${PAGE_INFO}
    }
  }
}`
interface PageWithRoot {
  id: string
  path: string
  rootpage: PageRecord<PageData>
}

function processPageRecord <T extends Omit<PageRecord<PageData>, 'data'>> (page: T): T {
  return {
    ...page,
    createdAt: new Date(page.createdAt),
    modifiedAt: new Date(page.modifiedAt),
    publishedAt: page.publishedAt != null ? new Date(page.publishedAt) : undefined
  }
}

const rootPageByIdLoader = new PrimaryKeyLoader({
  fetch: async (ids: string[], api: RenderingAPIClient) => {
    const { pages } = await api.query<{ pages: PageWithRoot[] }>(ROOTPAGE_QUERY, { ids, schemaversion, published: api.published })
    return pages.map(pwr => ({ ...pwr, rootpage: processPageRecord(pwr.rootpage) }))
  },
  extractId: (pageWithRoot) => pageWithRoot.id
})
const rootPageByPathLoader = new PrimaryKeyLoader({
  fetch: async (paths: string[], api: RenderingAPIClient) => {
    const { pages } = await api.query<{ pages: PageWithRoot[] }>(ROOTPAGE_QUERY, { paths, schemaversion, published: api.published })
    return pages.map(pwr => ({ ...pwr, rootpage: processPageRecord(pwr.rootpage) }))
  },
  extractId: (pageWithRoot) => pageWithRoot.path,
  idLoader: rootPageByIdLoader
})
rootPageByIdLoader.addIdLoader(rootPageByPathLoader)

const PAGE_QUERY = `
query getPage ($ids: [ID!], $paths: [UrlSafePath!], $links: [PageLinkInput!], $pagetreeIds: [ID!], $schemaversion: DateTime!, $published: Boolean) {
  pages (filter: { ids: $ids, paths: $paths, links: $links, pagetreeIds: $pagetreeIds }) {
    ${PAGE_INFO}
  }
}`
const PAGE_QUERY_NO_DATA = `
query getPage ($ids: [ID!], $paths: [UrlSafePath!], $links: [PageLinkInput!], $pagetreeIds: [ID!]) {
  pages (filter: { ids: $ids, paths: $paths, links: $links, pagetreeIds: $pagetreeIds }) {
    ${PAGE_INFO_NODATA}
  }
}`
type PageWithNoData<T extends PageData = PageData> = Omit<PageRecord<T>, 'data'>
const pageByIdLoader = new PrimaryKeyLoader({
  fetch: async (ids: string[], api: RenderingAPIClient) => {
    const { pages } = await api.query<{ pages: PageRecord[] }>(PAGE_QUERY, { ids, schemaversion, published: api.published })
    return pages.map(processPageRecord)
  },
  extractId: p => p.id
})
const pageByPathLoader = new PrimaryKeyLoader({
  fetch: async (paths: string[], api: RenderingAPIClient) => {
    const samesitepaths: string[] = []
    const othersitepaths: string[] = []
    for (const path of paths) {
      if (api.pagetreeId && api.sitename && path.startsWith('/' + api.sitename)) samesitepaths.push(path)
      else othersitepaths.push(path)
    }
    const [samesitepages, othersitepages] = await Promise.all([
      (async () => {
        if (!samesitepaths.length) return []
        const { pages } = await api.query<{ pages: PageRecord[] }>(PAGE_QUERY, { paths, schemaversion, published: api.published, pagetreeIds: [api.pagetreeId] })
        return pages.map(processPageRecord)
      })(),
      (async () => {
        if (!othersitepaths.length) return []
        const { pages } = await api.query<{ pages: PageRecord[] }>(PAGE_QUERY, { paths, schemaversion, published: api.published })
        return pages.map(processPageRecord)
      })()
    ])
    return samesitepages.concat(othersitepages)
  },
  extractId: p => p.path,
  idLoader: pageByIdLoader
})
pageByIdLoader.addIdLoader(pageByPathLoader)
const pageByLinkWithoutData = new BestMatchLoader<PageLink, Omit<PageRecord<PageData>, 'data'>>({
  fetch: async (links, api: RenderingAPIClient) => {
    const pageLinks = links.filter(l => l.type === 'page').map(l => api.pagetreeId ? { ...pick(l, 'siteId', 'linkId', 'path'), context: { pagetreeId: api.pagetreeId } } : pick(l, 'siteId', 'linkId', 'path'))
    const { pages } = await api.query<{ pages: PageWithNoData[] }>(PAGE_QUERY_NO_DATA, { links: pageLinks })
    return pages.map(processPageRecord)
  },
  scoreMatch: (link, page) => {
    if (link.siteId !== page.site.id) return 0
    if (link.linkId === page.linkId) return 2
    if (link.path === page.path) return 1
    return 0
  }
})
const pageByLinkLoader = new BestMatchLoader<PageLink, PageRecord>({
  fetch: async (links, api: RenderingAPIClient) => {
    const pageLinks = links.filter(l => l.type === 'page').map(l => api.pagetreeId ? { ...pick(l, 'siteId', 'linkId', 'path'), context: { pagetreeId: api.pagetreeId } } : pick(l, 'siteId', 'linkId', 'path'))
    const { pages } = await api.query<{ pages: PageRecord<PageData>[] }>(PAGE_QUERY, { links: pageLinks, published: api.published, schemaversion })
    return pages.map(processPageRecord)
  },
  scoreMatch: (link, page) => {
    if (link.siteId !== page.site.id) return 0
    if (link.linkId === page.linkId) return 2
    if (link.path === page.path) return 1
    return 0
  },
  idLoader: [pageByIdLoader, pageByPathLoader]
})

const templateCache = new Cache(async (_, api: RenderingAPIClient) => {
  const { templates } = await api.query<{ templates: { key: string, name: string, templateProperties: any, areas: { name: string }[] }[] }>(`
    query getTemplateInfo {
      templates {
        key
        name
        templateProperties
        areas {
          name
        }
      }
    }
  `)
  return keyby(templates, 'key')
})

export interface FetchedData {
  id: string
  name: string
  data: DataData
  path: string
  publishedAt?: string
  modifiedAt: string
  site?: {
    id: string
    name: string
  }
  template: {
    key: string
  }
}

function fetchedDataToRecord (d: Pick<FetchedData, 'id' | 'name' | 'path' | 'data' | 'modifiedAt' | 'publishedAt'>): DataRecord {
  return { ...pick(d, 'id', 'name', 'path', 'data'), modifiedAt: new Date(d.modifiedAt), publishedAt: d.publishedAt ? new Date(d.publishedAt) : undefined }
}

const dataByPathLoader = new OneToManyLoader({
  fetch: async (paths: string[], api: RenderingAPIClient) => {
    const { data } = await api.query<{ data: FetchedData[] }>(
      'query getDataByPath ($paths: [UrlSafePath!]!, $published: Boolean!) { data (filter: { beneathOrAt: $paths, published: $published, deleteStates: [NOTDELETED] }) { id name data(published: $published) path publishedAt modifiedAt site { id name } template { key } } }'
      , { paths, published: api.published }
    )
    return data
  },
  matchKey: (path: string, d: FetchedData) => d.path.startsWith(path)
})

const dataByDataLinkLoader = new BestMatchLoader({
  fetch: async (links: DataLink[], api: RenderingAPIClient) => {
    const { data } = await api.query<{ data: FetchedData[] }>(
      'query getDataByLink ($links: [DataLinkInput!]!, $published: Boolean!) { data (filter: { links: $links, published: $published, deleteStates: [NOTDELETED] }) { id name data(published:$published) path publishedAt modifiedAt site { id name } template { key } } }'
      , { links: links.map(l => pick(l, 'id', 'siteId', 'path', 'templateKey')), published: api.published })
    return data
  },
  scoreMatch: (link, data) => {
    if (link.templateKey !== data.template.key) return 0
    if (link.siteId !== data.site?.id) return 0
    if (link.id === data.id) return 2
    if (link.path === data.path) return 1
    return 0
  }
})

export interface FetchedDataFolder {
  id: string
  name: string
  path: string
  template: {
    key: string
  }
  site?: {
    id: string
    name: string
  }
  data: {
    id: string
    name: string
    path: string
    publishedAt?: string
    modifiedAt: string
    data: DataData
  }[]
}

const dataFolderByFolderLinkLoader = new BestMatchLoader({
  fetch: async (links: DataFolderLink[], api: RenderingAPIClient) => {
    const { datafolders } = await api.query<{ datafolders: FetchedDataFolder[] }>(
      'query getDataFolderByLink ($links: [DataFolderLinkInput!]!, $published: Boolean!) { datafolders (filter: { links: $links, deleteStates: [NOTDELETED] }){ id name path template { key } site { id name } data(filter:{published:$published, deleteStates: [NOTDELETED]}) { id name path publishedAt modifiedAt data(published: $published) } } }'
      , { links: links.map(l => pick(l, 'id', 'siteId', 'path', 'templateKey')), published: api.published })
    return datafolders
  },
  scoreMatch: (link, folder) => {
    if (link.templateKey !== folder.template.key) return 0
    if (link.siteId !== folder.site?.id) return 0
    if (link.id === folder.id) return 2
    if (link.path === folder.path) return 1
    return 0
  }
})

export class RenderingAPIClient implements APIClient {
  dlf = new DataLoaderFactory(this)
  token: string
  pagetreeId?: string
  sitename?: string
  sitePrefix?: string
  context: 'live' | 'preview' | 'edit' = 'live'
  contextOrigin: string
  resolvedLinks = new Map<string, string | undefined>()
  static contextPath = process.env.CONTEXT_PATH ?? ''

  constructor (public published: boolean, token?: string, req?: FastifyRequest) {
    this.token = isBlank(token) ? anonToken : token
    // req is only undefined when we are querying a token
    // it will never be null when rendering a page
    this.contextOrigin = req ? `${req.protocol}://${req.hostname}` : ''
  }

  async getAncestors ({ id, path }: { id?: string, path?: string }) {
    const page = (id && await this.dlf.get(ancestorsByIdLoader).load(id)) ??
      (path && await this.dlf.get(ancestorsByPathLoader).load(path))
    if (!page) throw new Error(`Unable to retrieve ancestors for id = ${id ?? ''}, path = ${path ?? ''}`)
    return page.ancestors.reverse()
  }

  async getRootPage ({ id, path }: { id?: string, path?: string }) {
    const page = (id && await this.dlf.get(rootPageByIdLoader).load(id)) ??
      (path && await this.dlf.get(rootPageByPathLoader).load(path))
    if (!page) throw new Error(`Unable to retrieve root page for id = ${id ?? ''}, path = ${path ?? ''}`)
    return page.rootpage
  }

  async getPage ({ id, path, link }: { id?: string, path?: string, link?: string | PageLinkWithContext }) {
    link = typeof link === 'string' ? JSON.parse(link) : link
    const page = (id && await this.dlf.get(pageByIdLoader).load(id)) ??
    (path && await this.dlf.get(pageByPathLoader).load(path)) ??
    (link && await this.dlf.get(pageByLinkLoader).load(link as PageLink))
    if (!page) return undefined
    return { ...page, title: isBlank(page.data.title) ? titleCase(page.name) : page.data.title }
  }

  async getNavigation (opts?: { beneath?: string, depth?: number, extra?: string[], absolute?: boolean, published?: boolean }) {
    opts ??= {}
    if (opts.beneath && opts.beneath !== '/' && opts.depth != null) opts.depth += opts.beneath.split('/').length - 1
    const { pages } = await this.query<{ pages: { id: string, name: string, fallbackTitle: string, path: string, publishedAt: string | undefined, site: SiteInfo, pagetree: { id: string }, parent?: { id: string }, extra: any }[] }>(`
      query getNavigation ($pagetreeId: ID!, $beneath: [UrlSafePath!], $depth: Int, $published: Boolean, $dataPaths: [String!]!) {
        pages (filter: { pagetreeIds: [$pagetreeId], maxDepth: $depth, published: $published, beneath: $beneath, deleteStates: [NOTDELETED] }) {
          id
          name
          fallbackTitle
          path
          publishedAt
          ${SITE_INFO}
          pagetree { id }
          parent { id }
          extra: dataByPath (paths: $dataPaths, published: $published)
        }
      }
    `, { pagetreeId: this.pagetreeId, depth: opts.depth, dataPaths: opts.extra ?? [], published: !!opts.published || this.published, beneath: toArray(opts.beneath) })
    const pagesForNavigation = pages.map<PageForNavigation & { parent?: { id: string } }>(p => ({
      ...p,
      title: p.fallbackTitle,
      href: this.getHref(p, { absolute: opts!.absolute }) ?? '',
      publishedAt: p.publishedAt ? new Date(p.publishedAt) : undefined,
      children: []
    }))
    const pagesById = keyby(pagesForNavigation, 'id')
    const roots: PageForNavigation[] = []
    for (const page of pagesForNavigation) {
      if (!page.parent || !pagesById[page.parent.id]) roots.push(page)
      else pagesById[page.parent.id].children.push(page)
    }
    return roots
  }

  async resolveLink (lnk: string | LinkDefinition | undefined, opts?: { absolute?: boolean, extension?: string }) {
    const { href } = await this.resolveLinkPlus(lnk, opts)
    return href
  }

  async resolveLinkPlus (lnk: string | LinkDefinition | undefined, opts?: { absolute?: boolean, extension?: string }): Promise<{ href?: string, title?: string, broken: boolean }> {
    if (!lnk) return { broken: true }
    const rOpts = {
      absolute: !!opts?.absolute,
      extension: opts?.extension?.replace(/^\.+/, '') ?? 'html'
    }
    const link = typeof lnk === 'string' ? JSON.parse(lnk) as LinkDefinition : lnk
    if (['data', 'datafolder', 'assetfolder'].includes(link.type)) return { broken: true }
    if (link.type === 'url') return { href: link.url, broken: false }
    if (link.type === 'page') {
      const target = await this.dlf.get(pageByLinkWithoutData).load(link)
      if (!target) {
        // link is to a page we can't find, but we'll try to return something readable even though it's broken
        if (this.context === 'live') {
          if (this.sitename && link.path.startsWith('/' + this.sitename)) {
            return { href: shiftPath(link.path), title: titleCase(link.path.split('/').slice(-1)[0]), broken: true }
          } else {
            return { href: link.path, title: titleCase(link.path.split('/').slice(-1)[0]), broken: true }
          }
        }
        return { href: this.getPreviewLink(link.path, rOpts), title: titleCase(link.path.split('/').slice(-1)[0]), broken: true }
      }
      return { href: this.getHref(target, opts), title: target.fallbackTitle, broken: false }
    } else if (link.type === 'asset') {
      const target = await this.getAssetByLink(link)
      if (!target) {
        return { href: `${this.assetPrefix()}${link.path ?? '/unknown-asset'}`, title: titleCase(link.path?.split('/').slice(-1)[0] ?? ''), broken: true }
      }
      return { href: this.assetHref(target), title: titleCase(target.name), broken: false }
    }
    return { broken: true }
  }

  private getPreviewLink (path: string, opts: { absolute: boolean, extension: string }) {
    let ret: string
    if (opts.absolute) {
      // absolute published preview url
      ret = resolvePath(this.contextOrigin + RenderingAPIClient.contextPath + `/.preview/${this.published ? 'public' : 'latest'}`, path)
    } else {
      // site-relative preview
      ret = resolvePath(RenderingAPIClient.contextPath + `/.preview/${this.published ? 'public' : 'latest'}`, path)
    }
    return ret + '.' + opts.extension
  }

  getHref (page: { path: string, site: SiteInfo, pagetree: { id: string } }, opts?: { absolute?: boolean, extension?: string }) {
    const { href } = this.getHrefPlus(page, opts)
    return href
  }

  getHrefPlus (page: { path: string, site: SiteInfo, pagetree: { id: string } }, opts?: { absolute?: boolean, extension?: string }): { broken: boolean, href: string } {
    const rOpts = {
      absolute: !!opts?.absolute,
      extension: opts?.extension?.replace(/^\.+/, '') ?? 'html'
    }
    if (this.context !== 'live' && page.site.name === this.sitename) {
      // linking between pagetrees should break but be readable, so we return path
      if (this.pagetreeId !== page.pagetree.id) return { href: page.path, broken: true }
      return { href: this.getPreviewLink(page.path, rOpts), broken: false }
    } else if (rOpts.absolute || page.site.name !== this.sitename) {
      // absolute launched url
      if (isBlank(page.site.url?.prefix)) { // not launched
        if (this.context === 'live') {
          // not launched and live, return path including site name, so it breaks but is readable
          return { href: page.path, broken: true }
        } else {
          // not launched but in preview or edit mode, produce a working link for now
          return { href: this.getPreviewLink(page.path, rOpts), broken: true }
        }
      }
      const pathWithoutSite = shiftPath(page.path)
      if (pathWithoutSite === '/' && page.site.url!.path === '/') {
        // launched and the prefix ends with the domain name, no path, so we can't add .html or we'd get example.org.html
        if (rOpts.extension === 'html') return { href: page.site.url!.prefix.replace(/\/$/, ''), broken: false }
        // variation like .rss, extension is important so we generate /.root.rss
        return { href: page.site.url!.prefix + '.root.' + rOpts.extension, broken: false }
      }
      return { href: resolvePath(page.site.url!.prefix, pathWithoutSite) + '.' + rOpts.extension, broken: false }
    } else {
      // site-relative launched url
      const pathWithoutSite = shiftPath(page.path)
      const resolvedPath = resolvePath(page.site.url?.path, pathWithoutSite)
      if (resolvedPath === '/') { // home page
        if (rOpts.extension === 'html') return { href: '/', broken: false }
        // variation like .rss, extension is important so we generate /.root.rss
        return { href: '/.root.' + rOpts.extension, broken: false }
      }
      return { href: resolvedPath + '.' + rOpts.extension, broken: false }
    }
  }

  async scanForLinks (text: string | undefined, opts?: { absolute?: boolean }) {
    const links = extractLinksFromText(text)
    const resolvedLinks = (await Promise.all(links.map(async l => await this.resolveLink(l, opts))))
    for (let i = 0; i < links.length; i++) this.resolvedLinks.set(ensureString(links[i]), resolvedLinks[i])
  }

  assetPrefix () {
    return this.context === 'live' ? process.env.DOSGATO_ASSET_LIVE_BASE! : RenderingAPIClient.contextPath + '/.asset'
  }

  assetHref (asset: FetchedAsset | undefined) {
    if (!asset) return 'brokenlink'
    if (asset.box) {
      return `${this.assetPrefix()}/${asset.id}/w/2000/${asset.checksum.substring(0, 12)}/${encodeURIComponent(asset.filename)}`
    } else {
      return `${this.assetPrefix()}/${asset.id}/${encodeURIComponent(asset.filename)}`
    }
  }

  resizeHref (resize: FetchedAsset['resizes'][number], asset: FetchedAsset) {
    return `${this.assetPrefix()}/${asset.id}/resize/${resize.id}/${encodeURIComponent(asset.filename)}`
  }

  assetHrefByWidth (asset: FetchedAsset, width: number) {
    return `${this.assetPrefix()}/${asset.id}/w/${width}/${asset.checksum.substring(0, 12)}/${encodeURIComponent(asset.filename)}`
  }

  srcSet (resizes: FetchedAsset['resizes'], asset: FetchedAsset) {
    return resizes.map(r => `${this.resizeHref(r, asset)} ${r.width}w`).join(', ')
  }

  async getImgAttributes (link: string | AssetLink | undefined, absolute?: boolean | undefined): Promise<PictureAttributes | undefined> {
    if (!link) return undefined
    const asset = await this.getAssetByLink(link)
    if (!asset) return undefined
    return this.getImgAttributesFromAsset(asset)
  }

  getImgAttributesFromAsset (asset: FetchedAsset | undefined) {
    if (!asset?.box) return undefined
    const resizesByMime = groupby(asset.resizes, 'mime')
    const widths = new Set<number>([asset.box.width])
    for (const resize of asset.resizes) {
      widths.add(resize.width)
    }
    return {
      src: this.assetHref(asset),
      width: asset.box.width,
      height: asset.box.height,
      srcset: Array.from(widths).map(w => `${this.assetHrefByWidth(asset, w)} ${w}w`).join(', '),
      widths: asset.resizes.filter(r => r.mime === asset.mime).map(r => ({ width: r.width, src: this.resizeHref(r, asset) })),
      alternates: Object.keys(resizesByMime).filter(m => m !== asset.mime).map(m => ({ mime: m, srcset: this.srcSet(resizesByMime[m], asset), widths: resizesByMime[m].map(r => ({ width: r.width, src: this.resizeHref(r, asset) })) }))
    }
  }

  async getDataByLink (link: string | DataLink | DataFolderLink): Promise<DataRecord[]> {
    if (typeof link === 'string') {
      const parsed = JSON.parse(link)
      if (parsed.type === 'data') link = parsed as DataLink
      else link = parsed as DataFolderLink
    }
    if (link.type === 'data') {
      const fetchedData = await this.dlf.get(dataByDataLinkLoader).load(link)
      return fetchedData ? [fetchedDataToRecord(fetchedData)] : []
    } else {
      const fetchedFolder = await this.dlf.get(dataFolderByFolderLinkLoader).load(link)
      return fetchedFolder ? fetchedFolder.data.map(fetchedDataToRecord) : []
    }
  }

  async getDataByPath (templateKey: string, path: string) {
    const data = await this.dlf.get(dataByPathLoader, this).load(path)
    return data.filter(d => d.template.key === templateKey).map(fetchedDataToRecord)
  }

  async getLaunchedPage (hostname: string, path: string, schemaversion: Date) {
    const { pages } = await this.#query<{ pages: (PageRecord & { site: { url: { prefix: string } }, pagetree: { id: string } })[] }>(anonToken, LAUNCHED_PAGE_QUERY, { launchUrl: `http://${hostname}${path}`, schemaversion, published: true })
    return pages[0] ? processPageRecord(pages[0]) : undefined
  }

  async getSiteInfoByLaunchUrl (launchUrl: string) {
    const { sites } = await this.#query<{ sites: { id: string, primaryPagetree: { id: string }, url: { path: string, prefix: string } }[] }>(anonToken, 'query getSiteByLaunchUrl ($launchUrl: String!) { sites (filter: { launchUrls: [$launchUrl] }) { id primaryPagetree { id } url { path prefix } } }', { launchUrl })
    return sites[0]
  }

  async getPreviewPage (path: string, schemaversion: Date, published?: true, version?: number) {
    const { pages } = await this.query<{ pages: (PageRecord & { site: { name: string }, pagetree: { id: string } })[] }>(PREVIEW_PAGE_QUERY, { path, schemaversion, published, version })
    return pages[0] ? processPageRecord(pages[0]) : undefined
  }

  async getAssetByLink (link: AssetLink | string) {
    if (typeof link === 'string') link = JSON.parse(link) as AssetLink
    return await this.dlf.get(assetByLinkLoader).load(link)
  }

  fetchedAssetToAssetRecord (asset: FetchedAsset) {
    return {
      ...asset,
      downloadLink: this.assetHref(asset),
      meta: asset.data,
      image: this.getImgAttributesFromAsset(asset)
    }
  }

  async getAssetsByLink (link: AssetLink | AssetFolderLink | string, recursive?: boolean): Promise<AssetRecord[]> {
    if (typeof link === 'string') link = JSON.parse(link) as AssetLink | AssetFolderLink
    if (link.type === 'asset') {
      const asset = await this.dlf.get(assetByLinkLoader).load(link)
      if (!asset) return [] as AssetRecord[]
      return [this.fetchedAssetToAssetRecord(asset)]
    }
    const folder = await this.dlf.get(assetfoldersByLinkLoader).load(link)
    if (!folder) return [] as AssetRecord[]
    const assets = await this.dlf.get(assetsByFolderPathLoader, { recursive }).load(folder.path)
    return assets.map(a => this.fetchedAssetToAssetRecord(a))
  }

  async identifyToken (token: string) {
    if (!this.token) return undefined
    const { users } = await this.#query<{ users: { id: string }[] }>(token, 'query identifyToken { users (filter: { ids: ["self"] }) { id } }')
    return users[0]?.id
  }

  async getTemplates () {
    return await templateCache.get(undefined, this)
  }

  async #query <T = any> (token: string, query: string, variables?: any) {
    const resp = await fetch(process.env.DOSGATO_API_BASE! + '/graphql', {
      method: 'POST',
      mode: 'no-cors',
      cache: 'no-cache',
      referrerPolicy: 'no-referrer',
      body: stringify({ query, variables }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    })
    if (resp.status >= 400) throw new HttpError(resp.status, await resp.text())
    const body = await resp.json()
    if (body.errors?.length) throw new Error(body.errors[0].message)
    return body.data as T
  }

  async query <T = any> (query: string, variables?: any) {
    return await this.#query<T>(this.token, query, variables)
  }
}

const httpAgent = new HttpAgent({ maxSockets: 50 })
const httpsAgent = new HttpsAgent({ maxSockets: 50 })
export async function download (url: string, token: string | undefined) {
  const get = url.startsWith('https:') ? httpsGet : httpGet
  const agent = url.startsWith('https:') ? httpsAgent : httpAgent
  return await new Promise<IncomingMessage>((resolve, reject) => {
    get(url, { headers: { Authorization: `Bearer ${token ?? anonToken}` }, agent }, resolve).on('error', reject)
  })
}
