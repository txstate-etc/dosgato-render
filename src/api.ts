import { APIClient, AssetLink, DataFolderLink, DataLink, extractLinksFromText, LinkDefinition, PageData, PageLink, PageRecord, replaceLinksInText } from '@dosgato/templating'
import { BestMatchLoader, DataLoaderFactory, PrimaryKeyLoader } from 'dataloader-factory'
import { SignJWT } from 'jose'
import { Cache, ensureString, isBlank, keyby, pick, stringify } from 'txstate-utils'
import { jwtSignKey } from './util.js'
import { schemaversion } from './version.js'
import cheerio from 'cheerio'
import { parseDocument } from 'htmlparser2'

const PAGE_INFO = `
id
linkId
path
data (schemaversion: $schemaversion, published: $published)
`

const PAGE_INFO_VERSION = `
id
linkId
path
data (schemaversion: $schemaversion, published: $published, version: $version)
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
const rootPageByIdLoader = new PrimaryKeyLoader({
  fetch: async (ids: string[], api: RenderingAPIClient) => {
    const { pages } = await api.query<{ pages: PageWithRoot[] }>(ROOTPAGE_QUERY, { ids, schemaversion, published: api.published })
    return pages
  },
  extractId: (pageWithRoot) => pageWithRoot.id
})
const rootPageByPathLoader = new PrimaryKeyLoader({
  fetch: async (paths: string[], api: RenderingAPIClient) => {
    const { pages } = await api.query<{ pages: PageWithRoot[] }>(ROOTPAGE_QUERY, { paths, schemaversion, published: api.published })
    return pages
  },
  extractId: (pageWithRoot) => pageWithRoot.path,
  idLoader: rootPageByIdLoader
})
rootPageByIdLoader.addIdLoader(rootPageByPathLoader)

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

  constructor (public published: boolean, token?: string) {
    this.token = isBlank(token) ? anonToken : token
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

  async getPage ({ id, path, link }: { id?: string, path?: string, link?: string | PageLink }) {
    link = typeof link === 'string' ? JSON.parse(link) : link
    const { pages } = await this.query<{ pages: PageRecord<PageData>[] }>(`
    query getAncestorPages ($ids: [ID!], $paths: [String!], $links: [PageLinkInput!], $schemaversion: DateTime!, $published: Boolean) {
      pages (filter: { ids: $ids, paths: $paths, links: $links }) {
        ${PAGE_INFO}
      }
    }`, { ids: id && [id], paths: path && [path], links: link && [link] })
    return pages[0]
  }

  async resolveLink (link: string | LinkDefinition, absolute?: boolean | undefined) {
    return 'http://example.com' // TODO
  }

  async processRich (text: string) {
    const links = extractLinksFromText(text)
    const resolvedLinks = await Promise.all(links.map(async l => await this.resolveLink(l)))
    const resolved = new Map<string, string>()
    for (let i = 0; i < links.length; i++) resolved.set(ensureString(links[i]), resolvedLinks[i])
    text = replaceLinksInText(text, resolved)
    const dom = parseDocument(text)
    const $ = cheerio.load(dom)
    return $.html()
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

  async getLaunchedPage (hostname: string, path: string, schemaversion: Date): Promise<PageRecord | undefined> {
    const { pages } = await this.#query<{ pages: PageRecord[] }>(anonToken, LAUNCHED_PAGE_QUERY, { launchUrl: `http://${hostname}${path}`, schemaversion, published: true })
    return pages[0]
  }

  async getPreviewPage (pagetreeId: string, path: string, schemaversion: Date, published?: true, version?: number): Promise<PageRecord | undefined> {
    const { pages } = await this.query<{ pages: PageRecord[] }>(PREVIEW_PAGE_QUERY, { pagetreeId, path, schemaversion, published, version })
    return pages[0]
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
    try {
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
      const body = await resp.json()
      if (body.errors?.length) throw new Error(body.errors[0].message)
      return body.data as T
    } catch (e: any) {
      throw new Error(e.message)
    }
  }

  async query <T = any> (query: string, variables?: any) {
    return await this.#query<T>(this.token, query, variables)
  }
}
