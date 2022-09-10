import { PageRecord, Page, Component, ResourceProvider, ComponentData, CSSBlock, JSBlock, FileDeclaration } from '@dosgato/templating'
import { transform } from 'esbuild'
import { fileTypeFromFile } from 'file-type'
import { readFileSync, statSync } from 'fs'
import mime from 'mime-types'
import sass from 'sass'
import semver from 'semver'
import { resourceversion } from './version.js'

function versionGreater (v2: string | undefined, v1: string | undefined) {
  if (v2 == null) return false
  if (v1 == null) return true
  return semver.gt(v2, v1)
}

function versionBreaking (v2: string | undefined, v1: string | undefined) {
  if (v2 === v1) return false
  if (v1 == null || v2 == null) return false
  return semver.major(v1) !== semver.major(v2)
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

function versionWarning <T extends JSBlock | CSSBlock> (existing: T | undefined, block: T, type: string, key: string) {
  if (existing && existing.version !== block.version) {
    const breaking = versionBreaking(existing.version, block.version)
    const log = breaking ? console.warn : console.info
    log(type, `block${breaking ? ' BREAKING' : ''} version conflict detected for`, key, '-', existing.version, 'vs', block.version)
  }
}

const importerUrl = new URL('http://dosgato-mixins.org')
class SimpleImporter {
  canonicalize (url: string, options: { fromImport: boolean }) {
    return templateRegistry.sassMixinString ? importerUrl : null
  }

  load (canonicalUrl: URL) {
    console.log(templateRegistry.sassMixinString)
    return { contents: templateRegistry.sassMixinString!, syntax: 'scss' as const }
  }
}

/**
 * This registry will get filled with Component and Page objects upon server startup. Each
 * instance of dosgato CMS will have a repo where the server administrator can import all the
 * Component and Page objects that will be available in their instance and pass them to the
 * API Server, Rendering Server, and Admin UI Server. This is how server owners have control
 * over their installations and opt-in to whatever templates they want to have/support.
 */
export class TemplateRegistry {
  public pages: Map<string, new (page: PageRecord, editMode: boolean) => Page> = new Map()
  public components: Map<string, new (component: ComponentData, path: string, parent: Component, editMode: boolean) => Component> = new Map()
  public cssblocks: Map<string, RegistryCSSBlock> = new Map()
  public jsblocks: Map<string, RegistryJSBlock> = new Map()
  public files: Map<string, { path: string, version?: string, extension?: string, mime: string, length: number }> = new Map()
  public all = [] as (typeof Component | typeof Page)[]
  public sassMixinPath?: string
  #sassMixinString?: string
  get sassMixinString () {
    this.#sassMixinString ??= this.sassMixinPath && readFileSync(this.sassMixinPath, 'utf8')
    return this.#sassMixinString
  }

  protected sassImporter = new SimpleImporter()

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
      versionWarning(existing, block, 'Javascript', key)
      if (!existing || versionGreater(block.version, existing.version)) {
        this.jsblocks.set(key, block)
        const finalBlock = block as RegistryJSBlock
        const js = finalBlock.js ?? readFileSync(finalBlock.path!, 'utf8')
        promises.push(transform(js, { minify: true, sourcemap: true, sourcefile: `${key}.js`, legalComments: 'none' }).then(minified => {
          finalBlock.js = minified.code ?? ''
          finalBlock.map = minified.map ?? ''
        }))
      }
    }
    for (const [key, block] of template.cssBlocks.entries()) {
      const existing = this.cssblocks.get(key)
      versionWarning(existing, block, 'CSS', key)
      if (!existing || versionGreater(block.version, existing.version)) {
        this.cssblocks.set(key, block)
        const finalBlock = block as RegistryCSSBlock
        let css = finalBlock.css ?? readFileSync(finalBlock.path!, 'utf8')
        finalBlock.fontfiles = this.findFontFiles(css)
        if (finalBlock.sass) {
          const compiled = sass.compileString(css, { sourceMap: true, sourceMapIncludeSources: true, importer: this.sassImporter })
          compiled.sourceMap!.file = `${key}.scss`
          compiled.sourceMap!.sources = [`${key}.scss`, 'mixins.scss']
          css = `${compiled.css}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(compiled.sourceMap), 'utf-8').toString('base64')} */`
        }
        promises.push(transform(css, { loader: 'css', minify: true, sourcemap: true, legalComments: 'none', sourcefile: `${key}.css` }).then(async minified => {
          finalBlock.css = minified.code
          finalBlock.map = minified.map
        }))
      }
    }
    for (const [key, block] of template.files.entries()) {
      const existing = this.files.get(key)
      if (!existing || versionGreater(block.version, existing.version)) {
        const stat = statSync(block.path)
        if (!block.mime) block.mime = (await fileTypeFromFile(block.path))?.mime
        if (!block.mime) continue // no mime type, no file
        const ext = mime.extension(block.mime)
        this.files.set(key, { ...block as Required<FileDeclaration>, length: stat.size, extension: ext || undefined })

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
