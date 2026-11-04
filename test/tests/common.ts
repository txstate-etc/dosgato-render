/**
 * Shared constants for the suite. These must stay in sync with
 * test/api-mock/fixtures.mjs and docker-compose.test.yml.
 */

/** Any non-empty bearer token works: the mock API does not verify tokens. */
export const token = 'fake-test-token'
export const authHeaders = { Authorization: `Bearer ${token}` }

/** DOSGATO_ADMIN_BASE in docker-compose.test.yml */
export const adminBase = 'http://admin-mock/.admin'

/** DOSGATO_ASSET_LIVE_BASE in docker-compose.test.yml */
export const assetLiveBase = 'http://assets.example/assets'

/** first 12 chars of heroChecksum in test/api-mock/fixtures.mjs */
export const heroChecksum12 = 'aBcDeFgHiJkL'

export const aboutQuoteV1 = 'Everything changes and nothing stands still.'
export const aboutQuoteV2 = 'The only constant in life is change.'

/**
 * Extract the resourceversion cachebuster from a rendered page, e.g. from
 * <link rel="stylesheet" href="/.resources/1730000000000/blanktemplate.css">
 */
export function extractResourceVersion (html: string) {
  const match = /\/\.resources\/(\d+)\//.exec(html)
  if (!match) throw new Error('no /.resources/ link found in rendered page')
  return match[1]
}
