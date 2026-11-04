/**
 * Fixture content for the mock DosGato API. The pages here use the template
 * implementations registered by test/testserver.ts (keyp1-4, keyc1-3, richtext,
 * horizontalrule, textimage, columnlayout, documents, team, teammember), so the
 * rendering server under test can hydrate and render them.
 */

export const heroChecksum = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789012345A'

export const sites = {
  1: { id: '1', name: 'site1', launched: true, url: { path: '/', prefix: 'http://render/' }, primaryPagetreeId: 'pt1' },
  2: { id: '2', name: 'site2', launched: false, url: null, primaryPagetreeId: 'pt2' }
}

const created = '2024-01-01T00:00:00.000Z'
const modified = '2024-06-01T00:00:00.000Z'
const published = '2024-06-02T00:00:00.000Z'

const quote = (quote, author) => ({ templateKey: 'keyc3', quote, author })

const rootPageData = {
  templateKey: 'keyp1',
  areas: {
    main: [
      { templateKey: 'richtext', title: 'Welcome', text: '<p>Hello world, this is the home page rich text.</p>' },
      { templateKey: 'keyc1', link: JSON.stringify({ type: 'page', linkId: 'lnk-about', siteId: '1', path: '/site1/about' }), text: 'About Us' }
    ]
  }
}

const componentsPageData = {
  templateKey: 'keyp3',
  areas: {
    main: [
      { templateKey: 'keyc2', title: 'Panel Title', areas: { content: [{ templateKey: 'horizontalrule' }] } },
      { templateKey: 'columnlayout', areas: { row: [quote('Column one quote', 'Author One'), quote('Column two quote', 'Author Two')] } },
      { templateKey: 'team', title: 'Our Team', areas: { members: [{ templateKey: 'teammember', name: 'Jane Smith', role: 'Director', areas: { teams: [] } }] } },
      { templateKey: 'textimage', title: 'Scenic View', text: 'A picture of campus.', image: JSON.stringify({ type: 'asset', id: 'al1', siteId: '1', path: '/site1/images/hero.png', checksum: heroChecksum }) },
      { templateKey: 'documents', title: 'Important Documents', assetfolder: JSON.stringify({ type: 'assetfolder', id: 'afl1', siteId: '1', path: '/site1/documents' }) }
    ]
  }
}

export const pages = [
  {
    id: '101',
    linkId: 'lnk-root',
    name: 'site1',
    path: '/site1',
    title: 'Site One Home',
    siteId: '1',
    pagetreeId: 'pt1',
    createdAt: created,
    modifiedAt: modified,
    publishedAt: published,
    publishedVersion: 1,
    latestVersion: 1,
    versions: { 1: rootPageData }
  },
  {
    id: '102',
    linkId: 'lnk-about',
    name: 'about',
    path: '/site1/about',
    title: 'About Us',
    siteId: '1',
    pagetreeId: 'pt1',
    createdAt: created,
    modifiedAt: modified,
    publishedAt: published,
    publishedVersion: 2,
    latestVersion: 2,
    versions: {
      1: { templateKey: 'keyp1', areas: { main: [quote('Everything changes and nothing stands still.', 'Heraclitus')] } },
      2: { templateKey: 'keyp1', areas: { main: [quote('The only constant in life is change.', 'Heraclitus')] } }
    }
  },
  {
    id: '103',
    linkId: 'lnk-components',
    name: 'components',
    path: '/site1/components',
    title: 'Component Gallery',
    siteId: '1',
    pagetreeId: 'pt1',
    createdAt: created,
    modifiedAt: modified,
    publishedAt: published,
    publishedVersion: 1,
    latestVersion: 1,
    versions: { 1: componentsPageData }
  },
  {
    id: '104',
    linkId: 'lnk-feed',
    name: 'feed',
    path: '/site1/feed',
    title: 'News Feed',
    siteId: '1',
    pagetreeId: 'pt1',
    createdAt: created,
    modifiedAt: modified,
    publishedAt: published,
    publishedVersion: 1,
    latestVersion: 1,
    versions: { 1: { templateKey: 'keyp2', areas: { main: [{ templateKey: 'richtext', title: 'Feed', text: '<p>Feed content lives here.</p>' }] } } }
  },
  {
    id: '105',
    linkId: 'lnk-404',
    name: '404',
    path: '/site1/404',
    title: 'Page Not Found',
    siteId: '1',
    pagetreeId: 'pt1',
    createdAt: created,
    modifiedAt: modified,
    publishedAt: published,
    publishedVersion: 1,
    latestVersion: 1,
    versions: { 1: { templateKey: 'keyp3', areas: { main: [{ templateKey: 'richtext', title: 'Page Not Found', text: '<p>The page you requested could not be found.</p>' }] } } }
  }
]

// getTemplateInfo must report each template's areas or the renderer will not
// hydrate any child components (see hydrateComponent in src/render.ts).
export const templates = [
  { key: 'keyp1', name: 'Page Template 1', templateProperties: {}, areas: [{ name: 'main' }] },
  { key: 'keyp2', name: 'Page Template 2', templateProperties: {}, areas: [{ name: 'main' }] },
  { key: 'keyp3', name: 'Page Template 3', templateProperties: {}, areas: [{ name: 'main' }] },
  { key: 'keyp4', name: 'Page Template 4', templateProperties: {}, areas: [{ name: 'main' }] },
  { key: 'keyc1', name: 'Link', templateProperties: {}, areas: [] },
  { key: 'keyc2', name: 'Panel', templateProperties: {}, areas: [{ name: 'content' }] },
  { key: 'keyc3', name: 'Quote', templateProperties: {}, areas: [] },
  { key: 'richtext', name: 'Rich Text', templateProperties: {}, areas: [] },
  { key: 'horizontalrule', name: 'Horizontal Rule', templateProperties: {}, areas: [] },
  { key: 'textimage', name: 'Text & Image', templateProperties: {}, areas: [] },
  { key: 'columnlayout', name: 'Column Layout', templateProperties: {}, areas: [{ name: 'row' }] },
  { key: 'documents', name: 'Documents', templateProperties: {}, areas: [] },
  { key: 'team', name: 'Team', templateProperties: {}, areas: [{ name: 'members' }] },
  { key: 'teammember', name: 'Team Member', templateProperties: {}, areas: [{ name: 'teams' }] },
  { key: 'keyd1', name: 'Data Template 1', templateProperties: {}, areas: [] },
  { key: 'keyd2', name: 'Building', templateProperties: {}, areas: [] }
]

// keyp1's fetch() queries keyd2 entries beneath /global and the keyd1 entry
// linked below, so the home page render exercises both data loaders.
export const datas = [
  {
    id: 'd1',
    name: 'building-a',
    path: '/global/building-a',
    templateKey: 'keyd2',
    data: { templateKey: 'keyd2', name: 'Building A', floors: 3 },
    site: null,
    createdAt: created,
    modifiedAt: modified,
    publishedAt: published
  },
  {
    id: 'd2',
    name: 'building-b',
    path: '/global/building-b',
    templateKey: 'keyd2',
    data: { templateKey: 'keyd2', name: 'Building B', floors: 7 },
    site: null,
    createdAt: created,
    modifiedAt: modified,
    publishedAt: published
  },
  {
    id: 'itchanges',
    name: 'red-content',
    path: '/site2/site2datafolder/red-content',
    templateKey: 'keyd1',
    data: { templateKey: 'keyd1', color: 'red', align: 'left' },
    site: { id: '2', name: 'site2' },
    createdAt: created,
    modifiedAt: modified,
    publishedAt: published
  }
]

export const assets = [
  {
    id: 'a1',
    linkId: 'al1',
    path: '/site1/images/hero.png',
    checksum: heroChecksum,
    name: 'hero',
    extension: 'png',
    filename: 'hero.png',
    mime: 'image/png',
    size: 54321,
    data: { meta: {} },
    resizes: [
      { id: 'rz1', width: 800, height: 600, mime: 'image/png' },
      { id: 'rz2', width: 400, height: 300, mime: 'image/webp' }
    ],
    box: { width: 800, height: 600 },
    site: { id: '1', name: 'site1' }
  },
  {
    id: 'a2',
    linkId: 'al2',
    path: '/site1/documents/report.pdf',
    checksum: 'reportreportreportreportreportreportreport0',
    name: 'report',
    extension: 'pdf',
    filename: 'report.pdf',
    mime: 'application/pdf',
    size: 1234,
    data: { meta: {} },
    resizes: [],
    box: null,
    site: { id: '1', name: 'site1' }
  },
  {
    id: 'a3',
    linkId: 'al3',
    path: '/site1/documents/schedule.csv',
    checksum: 'scheduleschedulescheduleschedulescheduleschA',
    name: 'schedule',
    extension: 'csv',
    filename: 'schedule.csv',
    mime: 'text/csv',
    size: 567,
    data: { meta: {} },
    resizes: [],
    box: null,
    site: { id: '1', name: 'site1' }
  }
]

export const assetfolders = [
  { id: 'af1', linkId: 'afl1', path: '/site1/documents', site: { id: '1', name: 'site1' } }
]
