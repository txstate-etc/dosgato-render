import { APIClient, AssetLink, DataFolderLink, DataLink, extractLinksFromText, LinkDefinition, PageData, PageForNavigation, PageLink, PageLinkWithContext, PageRecord, SiteInfo } from '@dosgato/templating'
import { BestMatchLoader, DataLoaderFactory, PrimaryKeyLoader } from 'dataloader-factory'
import type { FastifyRequest } from 'fastify'
import { SignJWT } from 'jose'
import { Cache, ensureString, isBlank, keyby, pick, stringify, titleCase, toArray } from 'txstate-utils'
import { jwtSignKey, resolvePath } from './util.js'
import { schemaversion } from './version.js'
import { HttpError } from 'fastify-txstate'

const SITE_INFO = 'site { id name launched url { path, prefix } }'

const PAGE_INFO = `
id
name
linkId
path
createdAt
modifiedAt
publishedAt
data (schemaversion: $schemaversion, published: $published)
${SITE_INFO}
`

const PAGE_INFO_VERSION = `
id
name
linkId
path
createdAt
modifiedAt
publishedAt
data (schemaversion: $schemaversion, published: $published, version: $version)
${SITE_INFO}
`

const LAUNCHED_PAGE_QUERY = `
query getLaunchedPage ($launchUrl: String!, $schemaversion: DateTime!, $published: Boolean) {
  pages (filter: { launchedUrls: [$launchUrl] }) {
    ${PAGE_INFO}
  }
}
`

const PREVIEW_PAGE_QUERY = `
query getPreviewPage ($pagetreeId: ID!, $schemaversion: DateTime!, $path: String!, $published: Boolean, $version: Int) {
  pages (filter: { pagetreeIds: [$pagetreeId], paths: [$path] }) {
    ${PAGE_INFO_VERSION}
  }
}
`

const anonToken = await new SignJWT({ sub: 'anonymous' })
  .setIssuer('dg-render')
  .setProtectedHeader({ alg: 'HS256' })
  .sign(jwtSignKey)

const assetByLinkLoader = new BestMatchLoader({
  fetch: async (links: AssetLink[], api: RenderingAPIClient) => {
    const { assets } = await api.query<{ assets: { id: string, path: string, checksum: string, name: string, extension: string, mime: string, resizes: { width: number, height: number, mime: string }[], box: { width: number, height: number } }[] }>(
      'query getAssetByLink ($links: [AssetLinkInput!]!) { assets (filter: { links: $links }) { id path checksum name extension mime resizes { width height mime } box { width height }  } }'
      , { links: links.map(l => pick(l, 'id', 'path', 'checksum')) })
    return assets
  },
  scoreMatch: (link, asset) => asset.id === link.id ? 3 : (asset.path === link.path ? 2 : (asset.checksum === link.checksum ? 1 : 0))
})

const ANCESTOR_QUERY = `
query getAncestorPages ($ids: [ID!], $paths: [String!], $schemaversion: DateTime!, $published: Boolean) {
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
query getRootPage ($ids: [ID!], $paths: [String!], $schemaversion: DateTime!, $published: Boolean) {
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
query getPage ($ids: [ID!], $paths: [String!], $links: [PageLinkInput!], $pagetreeIds: [ID!], $schemaversion: DateTime!, $published: Boolean) {
  pages (filter: { ids: $ids, paths: $paths, links: $links, pagetreeIds: $pagetreeIds }) {
    ${SITE_INFO}
    ${PAGE_INFO}
  }
}`
const PAGE_QUERY_NO_DATA = `
query getPage ($ids: [ID!], $paths: [String!], $links: [PageLinkInput!], $pagetreeIds: [ID!]) {
  pages (filter: { ids: $ids, paths: $paths, links: $links, pagetreeIds: $pagetreeIds }) {
    ${SITE_INFO}
    id
    linkId
    path
  }
}`
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
const pageByLinkWithoutDataLoader = new BestMatchLoader<PageLinkWithContext, Omit<PageRecord<PageData>, 'data'>>({
  fetch: async (links, api: RenderingAPIClient) => {
    if (api.pagetreeId) {
      for (const link of links) link.context = { pagetreeId: api.pagetreeId }
    }
    const { pages } = await api.query(PAGE_QUERY_NO_DATA, { links })
    return pages.map(processPageRecord)
  },
  scoreMatch: (link, page) => {
    if (link.siteId !== page.site.id) return 0
    if (link.linkId === page.linkId) return 2
    if (link.path === page.path) return 1
    return 0
  }
})
const pageByLinkLoader = new BestMatchLoader<PageLinkWithContext, PageRecord>({
  fetch: async (links, api: RenderingAPIClient) => {
    if (api.pagetreeId) {
      for (const link of links) link.context = { pagetreeId: api.pagetreeId }
    }
    const { pages } = await api.query<{ pages: PageRecord<PageData>[] }>(PAGE_QUERY, { links, published: api.published })
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
  const { templates } = await api.query<{ templates: { key: string, name: string, templateProperties: any }[] }>(`
    query getTemplateInfo {
      templates {
        key
        name
        templateProperties
      }
    }
  `)
  return keyby(templates, 'key')
})

export class RenderingAPIClient implements APIClient {
  dlf = new DataLoaderFactory(this)
  token: string
  pagetreeId?: string
  sitename?: string
  sitePrefix?: string
  context: 'live' | 'preview' | 'edit' = 'live'
  contextOrigin: string
  resolvedLinks = new Map<string, string>()
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
    return page
  }

  async getNavigation (opts?: { beneath?: string, depth?: number, extra?: string[], absolute?: boolean }) {
    opts ??= {}
    if (opts.beneath && opts.beneath !== '/' && opts.depth != null) opts.depth += opts.beneath.split('/').length - 1
    const { pages } = await this.query<{ pages: { id: string, name: string, title: string, path: string, site: SiteInfo, parent?: { id: string }, extra: any }[] }>(`
      query getNavigation ($pagetreeId: ID!, $beneath: [String!], $depth: Int, $published: Boolean, $dataPaths: [String!]!) {
        pages (filter: { pagetreeIds: [$pagetreeId], maxDepth: $depth, published: $published, beneath: $beneath }) {
          id
          name
          title
          path
          ${SITE_INFO}
          parent { id }
          extra: dataByPath (paths: $dataPaths, published: $published)
        }
      }
    `, { pagetreeId: this.pagetreeId, depth: opts.depth, dataPaths: opts.extra ?? [], published: this.published, beneath: toArray(opts.beneath) })
    const pagesForNavigation = pages.map<PageForNavigation & { parent?: { id: string } }>(p => ({
      ...p,
      title: isBlank(p.title) ? titleCase(p.name) : p.title,
      href: this.getHref(p, { absolute: opts!.absolute }),
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

  async resolveLink (lnk: string | LinkDefinition, opts?: { absolute?: boolean, extension?: string }) {
    const link = typeof lnk === 'string' ? JSON.parse(lnk) as LinkDefinition : lnk
    if (['data', 'datafolder', 'assetfolder'].includes(link.type)) return 'brokenlink'
    if (link.type === 'url') return link.url // TODO: relative URLs or assume absolute?
    if (link.type === 'page') {
      const target = await this.dlf.get(pageByLinkWithoutDataLoader).load(link)
      if (!target) return 'brokenlink'
      return this.getHref(target, opts)
    } else if (link.type === 'asset') {
      return 'http://example.com' // TODO
    }
    return 'brokenlink'
  }

  getHref (page: { path: string, site: SiteInfo }, opts?: { absolute?: boolean, extension?: string }) {
    let ret = ''
    if (opts?.absolute || page.site.name !== this.sitename) {
      // absolute launched url or fail if not launched
      ret = resolvePath(page.site.url?.prefix, page.path)
    } else if (opts?.absolute && this.context === 'preview') {
      // absolute published preview url
      ret = resolvePath(this.contextOrigin + RenderingAPIClient.contextPath + `/.preview/${this.pagetreeId!}/${this.published ? 'public' : 'latest'}`, page.path)
    } else if (opts?.absolute && this.context === 'edit') {
      // absolute edit url
      ret = resolvePath(this.contextOrigin + RenderingAPIClient.contextPath + `/.edit/${this.pagetreeId!}`, page.path)
    } else if (this.context === 'live') {
      // site-relative launched url
      ret = resolvePath(page.site.url?.path, page.path)
    } else if (this.context === 'edit') {
      // site-relative edit url
      ret = resolvePath(RenderingAPIClient.contextPath + `/.edit/${this.pagetreeId!}`, page.path)
    } else {
      // site-relative preview
      ret = resolvePath(RenderingAPIClient.contextPath + `/.preview/${this.pagetreeId!}/${this.published ? 'public' : 'latest'}`, page.path)
    }
    return `${ret}.${opts?.extension?.replace(/^\.+/, '') ?? 'html'}`
  }

  async scanForLinks (text: string) {
    const links = extractLinksFromText(text)
    const resolvedLinks = await Promise.all(links.map(async l => await this.resolveLink(l)))
    for (let i = 0; i < links.length; i++) this.resolvedLinks.set(ensureString(links[i]), resolvedLinks[i])
  }

  async getImgAttributes (link: string | AssetLink, absolute?: boolean | undefined) {
    return {} as any // TODO
  }

  async getPageData ({ id, path }: { id?: string, path?: string }) {
    return {} as any // TODO
  }

  async getDataByLink (link: string | DataLink | DataFolderLink) {
    return [] as any[] // TODO
  }

  async getDataByPath (templateKey: string, path: string) {
    return [] as any[] // TODO
  }

  async getLaunchedPage (hostname: string, path: string, schemaversion: Date) {
    const { pages } = await this.#query<{ pages: (PageRecord & { site: { url: { prefix: string } } })[] }>(anonToken, LAUNCHED_PAGE_QUERY, { launchUrl: `http://${hostname}${path}`, schemaversion, published: true })
    return processPageRecord(pages[0])
  }

  async getPreviewPage (pagetreeId: string, path: string, schemaversion: Date, published?: true, version?: number) {
    const { pages } = await this.query<{ pages: (PageRecord & { site: { name: string } })[] }>(PREVIEW_PAGE_QUERY, { pagetreeId, path, schemaversion, published, version })
    return processPageRecord(pages[0])
  }

  async getAssetByLink (link: AssetLink, dlf: DataLoaderFactory) {
    return await dlf.get(assetByLinkLoader).load(link)
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
    const resp = await fetch(process.env.DOSGATO_API_URL!, {
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
    if (resp.status >= 400) throw new HttpError(resp.status)
    const body = await resp.json()
    if (body.errors?.length) throw new Error(body.errors[0].message)
    return body.data as T
  }

  async query <T = any> (query: string, variables?: any) {
    return await this.#query<T>(this.token, query, variables)
  }
}
