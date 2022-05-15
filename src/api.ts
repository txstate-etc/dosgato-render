import { PageWithAncestors } from '@dosgato/templating'
import AgentKeepAlive from 'agentkeepalive'
import axios from 'axios'

const SINGLE_PAGE_INFO = `
id
linkId
path
data (schemaversion: $schemaversion, published: $published, version: $version)
`

const PAGE_INFO = `
ancestors {
  ${SINGLE_PAGE_INFO}
}
${SINGLE_PAGE_INFO}
`

const LAUNCHED_PAGE_QUERY = `
getLaunchedPage ($launchUrl: String!, $schemaversion: DateTime!, $published: Boolean, $version: Int) {
  pages (filter: { launchedUrls: [$launchUrl] }) {
    ${PAGE_INFO}
  }
}
`

const PREVIEW_PAGE_QUERY = `
getPreviewPage ($pagetreeId: ID!, $path: String!, $published: Boolean, $version: Int) {
  pages (filter: { pagetreeIds: [$pagetreeId], paths: [$path] }) {
    ${PAGE_INFO}
  }
}
`

export class APIClient {
  client = axios.create({
    baseURL: process.env.DOSGATO_API_URL,
    httpAgent: new AgentKeepAlive(),
    httpsAgent: new AgentKeepAlive.HttpsAgent()
  })

  async query <T = any> (query: string, variables?: any, token?: string) {
    const resp = (await this.client.post('/', { query, variables }, {
      headers: { authorization: `Bearer ${token ?? process.env.DOS_GATO_ANON_TOKEN!}` }
    })).data
    if (resp.errors?.length) throw new Error(resp.errors[0].message)
    return resp.data as T
  }

  async getLaunchedPage (hostname: string, path: string, schemaversion: Date): Promise<PageWithAncestors|undefined> {
    const { pages } = await this.query(LAUNCHED_PAGE_QUERY, { launchUrl: `http://${hostname}${path}`, schemaversion })
    return pages[0]
  }

  async getPreviewPage (token: string, pagetreeId: string, path: string, schemaversion: Date, published?: true, version?: number): Promise<PageWithAncestors|undefined> {
    const { pages } = await this.query<{ pages: PageWithAncestors[] }>(PREVIEW_PAGE_QUERY, { pagetreeId, path, schemaversion, published, version }, token)
    return pages[0]
  }
}

export const api = new APIClient()
