import { PageRecord, Page, Component, ResourceProvider, ComponentData, CSSBlock, JSBlock } from '@dosgato/templating'
import { transform } from 'esbuild'
import { readFileSync, statSync } from 'fs'
import mime from 'mime-types'
import semver from 'semver'
import { resourceversion } from './version.js'

function versionGreater (v2: string|undefined, v1: string|undefined) {
  if (v2 == null) return false
  if (v1 == null) return true
  return semver.gt(v2, v1)
}

interface RegistryCSSBlock extends CSSBlock {
  fontfiles?: {
    href: string
    format: string
  }[]
  map?: string
}

interface RegistryJSBlock extends JSBlock {
  map?: string
}

/**
 * This registry will get filled with Component and Page objects upon server startup. Each
 * instance of dosgato CMS will have a repo where the server administrator can import all the
 * Component and Page objects that will be available in their instance and pass them to the
 * API Server, Rendering Server, and Admin UI Server. This is how server owners have control
 * over their installations and opt-in to whatever templates they want to have/support.
 */
export class TemplateRegistry {
  public pages: Map<string, new (page: PageRecord) => Page> = new Map()
  public components: Map<string, new (component: ComponentData, path: string, parent: Component) => Component> = new Map()
  public cssblocks: Map<string, RegistryCSSBlock> = new Map()
  public jsblocks: Map<string, RegistryJSBlock> = new Map()
  public files: Map<string, { path: string, version?: string, extension?: string, mime: string, length: number }> = new Map()
  public all = [] as (typeof Component|typeof Page)[]

  async addTemplate (template: typeof Component | typeof Page) {
    if (!template.templateKey) throw new Error(`template ${template.name} has undefined templateKey, that must be corrected`)
    if (template.prototype instanceof Page && !this.pages.has(template.templateKey)) this.pages.set(template.templateKey, template as any)
    else if (!this.components.has(template.templateKey)) this.components.set(template.templateKey, template as any)
    this.all.push(template)
    await this.addProvider(template as any)
  }

  async addProvider<T extends typeof ResourceProvider> (template: T) {
    console.info('initializing template or resource provider', template.name)
    const promises: Promise<any>[] = []
    for (const [key, block] of template.jsBlocks.entries()) {
      const existing = this.jsblocks.get(key)
      if (!existing || versionGreater(block.version, existing.version)) {
        this.jsblocks.set(key, block)
        const finalBlock = block as RegistryJSBlock
        const js = finalBlock.js ?? readFileSync(finalBlock.path!, 'utf8')
        promises.push(transform(js, { minify: true, sourcemap: true, legalComments: 'none' }).then(minified => {
          finalBlock.js = minified.code ?? ''
          finalBlock.map = minified.map ?? ''
        }))
      }
    }
    for (const [key, block] of template.cssBlocks.entries()) {
      const existing = this.cssblocks.get(key)
      if (!existing || versionGreater(block.version, existing.version)) {
        this.cssblocks.set(key, block)
        const finalBlock = block as RegistryCSSBlock
        const css = finalBlock.css ?? readFileSync(finalBlock.path!, 'utf8')
        finalBlock.fontfiles = this.findFontFiles(css)
        promises.push(transform(css, { loader: 'css', minify: true, sourcemap: true, legalComments: 'none' }).then(minified => {
          finalBlock.css = minified.code
          finalBlock.map = minified.map
        }))
      }
    }
    for (const [key, block] of template.files.entries()) {
      const existing = this.files.get(key)
      if (!existing || versionGreater(block.version, existing.version)) {
        const stat = statSync(block.path)
        const ext = mime.extension(block.mime)
        this.files.set(key, { ...block, length: stat.size, extension: ext || undefined })

        // write back to the component's `webpaths` property so it will know where its files
        // live on the rendering server
        const webpath = `/.resources/${resourceversion}/${key}${ext ? '.' + ext : ''}`
        template.webpaths.set(key, webpath)
      }
    }
    await Promise.all(promises)

    // now that we've registered and minified the JS and CSS, we can allow the original
    // unminified code to get garbage collected
    for (const k of template.jsBlocks.keys()) template.jsBlocks.set(k, {})
    for (const k of template.cssBlocks.keys()) template.cssBlocks.set(k, {})
    console.info('finished template or resource provider', template.name)
  }

  getTemplate (templateKey: string) {
    return this.pages.get(templateKey) ?? this.components.get(templateKey)
  }

  protected findFontFiles (css: string) {
    const ret = new Map<string, { href: string, format: string }>()
    const matches = css.match(/url\((.*?)\)\s+format\(['"](.*?)['"]\);/i)
    for (const match of matches ?? []) {
      if (match[2] === 'woff2') ret.set(match[1], { href: match[1], format: 'font/woff2' })
    }
    return Array.from(ret.values())
  }
}

export const templateRegistry = new TemplateRegistry()
