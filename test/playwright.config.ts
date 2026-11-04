import type { PlaywrightTestConfig } from '@playwright/test'

// No webServer block: the render server and the api-mock are brought up by
// docker-compose.test.yml, and the testing container only starts once the
// render service's /health check passes.
const config: PlaywrightTestConfig = {
  testDir: 'tests',
  testMatch: /(.+\.)?(test|spec)\.[jt]s/,
  // the suite asserts against one shared render service; run serially
  workers: 1,
  // the keyp2 page template deliberately sleeps 2 seconds in its fetch phase
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://render'
  },
  // Keep Playwright's own artifact scratch dir away from the mounted
  // /test-results dir, which it would otherwise wipe on every run.
  outputDir: '/tmp/playwright-artifacts',
  reporter: [['list'], ['junit', { outputFile: '/test-results/results.xml' }]]
}

export default config
