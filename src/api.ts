import { APIClient, AssetLink, DataFolderLink, DataLink, LinkDefinition, PageRecord } from '@dosgato/templating'
import AgentKeepAlive from 'agentkeepalive'
import axios from 'axios'
import { BestMatchLoader, DataLoaderFactory } from 'dataloader-factory'
import { SignJWT } from 'jose'
import { isBlank, pick } from 'txstate-utils'
import { jwtSignKey } from './util.js'

const PAGE_INFO = `
id
linkId
path
data (schemaversion: $schemaversion, published: $published, version: $version)
`

const LAUNCHED_PAGE_QUERY = `
query getLaunchedPage ($launchUrl: String!, $schemaversion: DateTime!, $published: Boolean, $version: Int) {
  pages (filter: { launchedUrls: [$launchUrl] }) {
    ${PAGE_INFO}
  }
}
`

const PREVIEW_PAGE_QUERY = `
query getPreviewPage ($pagetreeId: ID!, $schemaversion: DateTime!, $path: String!, $published: Boolean, $version: Int) {
  pages (filter: { pagetreeIds: [$pagetreeId], paths: [$path] }) {
    ${PAGE_INFO}
  }
}
`
const client = axios.create({
  baseURL: process.env.DOSGATO_API_URL,
  httpAgent: new AgentKeepAlive(),
  httpsAgent: new AgentKeepAlive.HttpsAgent()
})

const anonToken = await new SignJWT({ sub: 'anonymous' })
  .setIssuer('dg-render')
  .setProtectedHeader({ alg: 'HS256' })
  .sign(jwtSignKey)

export class RenderingAPIClient implements APIClient {
  dlf = new DataLoaderFactory()
  token: string

  constructor (token?: string) {
    this.token = isBlank(token) ? anonToken : token
  }

  async resolveLink (link: string | LinkDefinition, absolute?: boolean | undefined) {
    return 'http://example.com' // TODO
  }

  async processRich (text: string) {
    return text // TODO
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

  async #query <T = any> (token: string, query: string, variables?: any) {
    try {
      const resp = (await client.post('', { query, variables }, {
        headers: { authorization: `Bearer ${token}` }
      })).data
      if (resp.errors?.length) throw new Error(resp.errors[0].message)
      return resp.data as T
    } catch (e: any) {
      throw new Error(e.message)
    }
  }

  async query <T = any> (query: string, variables?: any) {
    return await this.#query<T>(this.token, query, variables)
  }

  async getLaunchedPage (hostname: string, path: string, schemaversion: Date): Promise<PageRecord|undefined> {
    const { pages } = await this.#query<{ pages: PageRecord[] }>(anonToken, LAUNCHED_PAGE_QUERY, { launchUrl: `http://${hostname}${path}`, schemaversion })
    return pages[0]
  }

  async getPreviewPage (pagetreeId: string, path: string, schemaversion: Date, published?: true, version?: number): Promise<PageRecord|undefined> {
    const { pages } = await this.query<{ pages: PageRecord[] }>(PREVIEW_PAGE_QUERY, { pagetreeId, path, schemaversion, published, version })
    return pages[0]
  }

  async identifyToken (token: string) {
    if (!this.token) return undefined
    const { users } = await this.#query<{ users: { id: string }[] }>(token, 'query identifyToken { users (filter: { ids: ["self"] }) { id } }')
    return users[0]?.id
  }

  assetByLinkLoader = new BestMatchLoader({
    fetch: async (links: AssetLink[], ctx) => {
      const { assets } = await this.query<{ assets: { id: string, path: string, checksum: string, name: string, extension: string, mime: string, resizes: { width: number, height: number, mime: string }[], box: { width: number, height: number } }[] }>(
        'query getAssetByLink ($links: [AssetLinkInput!]!) { assets (filter: { links: $links }) { id path checksum name extension mime resizes { width height mime } box { width height }  } }'
        , { links: links.map(l => pick(l, 'id', 'path', 'checksum')) })
      return assets
    },
    scoreMatch: (link, asset) => asset.id === link.id ? 3 : (asset.path === link.path ? 2 : (asset.checksum === link.checksum ? 1 : 0))
  })

  async getAssetByLink (link: AssetLink, dlf: DataLoaderFactory) {
    return await dlf.get(this.assetByLinkLoader).load(link)
  }
}
