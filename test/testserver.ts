import { RenderingServer } from '../src/index.js'
import { resourceversion } from '../src/version.js'
import { RichTextTemplate } from './components/richtext.js'
import { TextImageTemplate } from './components/textimage.js'
import { api } from './mockapi.js'
import { BlankTemplate } from './pages/blank.js'

const server = new RenderingServer()
await server.start({
  api,
  templates: [
    BlankTemplate,
    RichTextTemplate,
    TextImageTemplate
  ]
})
console.info('service started with resourceversion =', resourceversion)
