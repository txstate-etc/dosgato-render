import { PageWithAncestors } from '@dosgato/templating'
import { APIClient } from '../src/api.js'

class MockAPIClient extends APIClient {
  async getLaunchedPage (hostname: string, path: string, schemaversion: Date): Promise<PageWithAncestors|undefined> {
    return {
      id: '1',
      linkId: 'abc',
      ancestors: [],
      path: '/test',
      data: {
        templateKey: 'blank',
        savedAtVersion: new Date(),
        areas: {
          main: [
            {
              templateKey: 'richtext',
              title: 'My Rich Editor',
              text: '<p>Hello world!</p>'
            } as any,
            {
              templateKey: 'textimage',
              title: 'My Text & Image',
              text: 'This image is amazing.',
              image: '{ type: "asset", source: "internal", id: "1", path: "/test/image", checksum: "aaaaa" }'
            }
          ]
        }
      }
    }
  }

  async getPreviewPage (token: string, pagetreeId: string, path: string, schemaversion: Date, published?: true, version?: number): Promise<PageWithAncestors|undefined> {
    return await this.getLaunchedPage('', path, schemaversion)
  }
}

export const api = new MockAPIClient()
