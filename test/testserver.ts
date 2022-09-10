import { getFilePath, RenderingServer } from '../src/index.js'
import { templateRegistry } from '../src/registry.js'
import { resourceversion } from '../src/version.js'
import { LinkTemplate } from './components/link.js'
import { PanelTemplate } from './components/panel.js'
import { QuoteTemplate } from './components/quote.js'
import { RichTextTemplate } from './components/richtext.js'
import { TextImageTemplate } from './components/textimage.js'
import { PageTemplate1 } from './pages/keyp1.js'
import { PageTemplate2 } from './pages/keyp2.js'
import { PageTemplate3 } from './pages/keyp3.js'
import { PageTemplate4 } from './pages/keyp4.js'

const server = new RenderingServer()
templateRegistry.sassMixinPath = getFilePath(import.meta.url, 'mixins.scss')
await server.start({
  templates: [
    PageTemplate1,
    PageTemplate2,
    PageTemplate3,
    PageTemplate4,
    LinkTemplate,
    PanelTemplate,
    QuoteTemplate,
    RichTextTemplate,
    TextImageTemplate
  ]
})
console.info('service started with resourceversion =', resourceversion)
