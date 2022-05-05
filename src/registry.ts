import { PageRecord, Page, Component, ResourceProvider, ComponentData, CSSBlock, JSBlock } from '@dosgato/templating'
import { minify } from 'csso'
import { readFileSync, statSync } from 'fs'
import mime from 'mime-types'
import semver from 'semver'
import { minify as jsminify } from 'terser'
import { resourceversion } from './version'

function versionGreater (v2: string|undefined, v1: string|undefined) {
  if (v2 == null) return false
  if (v1 == null) return true
  return semver.gt(v2, v1)
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
  public cssblocks: Map<string, CSSBlock & { fontfiles?: { href: string, format: string }[], map?: string }> = new Map()
  public jsblocks: Map<string, JSBlock & { map?: string }> = new Map()
  public files: Map<string, { path: string, version?: string, extension?: string, mime: string, length: number }> = new Map()
  public all = [] as (typeof Component)[]

  addTemplate<T extends typeof Component> (template: T) {
    if (template instanceof Page && !this.pages.has(template.templateKey)) this.pages.set(template.templateKey, template as any)
    else if (!this.components.has(template.templateKey)) this.components.set(template.templateKey, template as any)
    this.all.push(template)
    this.addProvider(template as any)
  }

  addProvider<T extends typeof ResourceProvider> (template: T) {
    console.info('initializing template or resource provider', template.name)
    for (const [key, block] of template.jsBlocks.entries()) {
      const existing = this.jsblocks.get(key)
      if (!existing || versionGreater(block.version, existing.version)) this.jsblocks.set(key, block)
    }
    for (const [key, block] of template.cssBlocks.entries()) {
      const existing = this.cssblocks.get(key)
      if (!existing || versionGreater(block.version, existing.version)) this.cssblocks.set(key, block)
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
    for (const block of this.cssblocks.values()) {
      const css = block.css ?? readFileSync(block.path!, 'utf8')
      block.fontfiles = this.findFontFiles(css)
      const minified = minify(css, { sourceMap: true })
      block.css = minified.css
      block.map = JSON.stringify(minified.map)
    }
    for (const block of this.jsblocks.values()) {
      const js = block.js ?? readFileSync(block.path!, 'utf8')
      jsminify(js, { sourceMap: true }).then(minified => {
        block.js = minified.code ?? ''
        block.map = minified.map as string ?? ''
      }).catch(e => console.error(e))
    }
    // now that we've registered and minified the JS and CSS, we can allow the original
    // unminified code to get garbage collected
    template.jsBlocks.clear()
    template.cssBlocks.clear()
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
