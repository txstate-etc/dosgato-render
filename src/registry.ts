import { PageRecord, Page, Component, ResourceProvider, ComponentData, CSSBlock, JSBlock, FileDeclaration, SCSSInclude, replaceLinksInText } from '@dosgato/templating'
import cheerio from 'cheerio'
import { transform } from 'esbuild'
import { fileTypeFromFile } from 'file-type'
import { readFileSync, statSync } from 'fs'
import { parseDocument } from 'htmlparser2'
import mime from 'mime-types'
import sass from 'sass'
import semver from 'semver'
import { isBlank, isNotBlank } from 'txstate-utils'
import { RenderingAPIClient } from './api.js'
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

export interface RegistryCSSBlock extends CSSBlock {
  fontfiles?: {
    href: string
    format: string
  }[]
  map?: string
  size: number
}

export interface RegistryJSBlock extends JSBlock {
  map?: string
  size: number
}

export interface RegistryFile extends FileDeclaration {
  size: number
  mime: string
  extension?: string
}

export type RegistrySCSSInclude = SCSSInclude & { scss: string }

function versionWarning <T extends JSBlock | CSSBlock> (existing: T | undefined, block: T, type: string, key: string) {
  if (existing && existing.version !== block.version) {
    const breaking = versionBreaking(existing.version, block.version)
    const log = breaking ? console.warn : console.info
    log(type, `block${breaking ? ' BREAKING' : ''} version conflict detected for`, key, '-', existing.version, 'vs', block.version)
  }
}

class SimpleImporter {
  canonicalize (url: string, options: { fromImport: boolean }) {
    return new URL(url, 'http://dosgato-mixins.org/')
  }

  load (canonicalUrl: URL) {
    const name = canonicalUrl.pathname.substring(1)
    return { contents: templateRegistry.sassincludes.get(name)!.scss, syntax: 'scss' as const, sourceMapUrl: canonicalUrl }
  }
}
const importer = new SimpleImporter()

function updateTag (h: cheerio.Cheerio<cheerio.Element>, level: number) {
  for (const itm of h) { itm.tagName = `h${Math.min(6, level)}` }
}

function addHeaderClass (h: cheerio.Cheerio<cheerio.Element>, level: number, difference: number) {
  h.addClass(`h${level - difference}styles`)
}

function processHeaders (isRoot: boolean, currentLevel: number, parentLevel: number, headerIndex: number, allHeaders: cheerio.Cheerio<cheerio.Element>, highestLevel: number) {
  while (headerIndex < allHeaders.length) {
    const h = allHeaders.eq(headerIndex)
    const headerLevel = parseInt(h.get(0)!.tagName.substring(1))
    const difference = highestLevel - 3
    if (headerLevel > parentLevel) {
      updateTag(h, currentLevel)
      addHeaderClass(h, currentLevel, difference)
      headerIndex = processHeaders(false, currentLevel + 1, headerLevel, headerIndex + 1, allHeaders, highestLevel)
    } else if (isRoot) {
      updateTag(h, highestLevel)
      addHeaderClass(h, currentLevel, difference)
      headerIndex = processHeaders(false, highestLevel + 1, headerLevel, headerIndex + 1, allHeaders, highestLevel)
    } else if (headerLevel === parentLevel) {
      updateTag(h, currentLevel - 1)
      addHeaderClass(h, currentLevel - 1, difference)
      headerIndex++
    } else {
      break
    }
  }
  return headerIndex
}

/**
 * This registry will get filled with Component and Page objects upon server startup. Each
 * instance of dosgato CMS will have a repo where the server administrator can import all the
 * Component and Page objects that will be available in their instance and pass them to the
 * API Server, Rendering Server, and Admin UI Server. This is how server owners have control
 * over their installations and opt-in to whatever templates they want to have/support.
 */
export class TemplateRegistry {
  public pages: Map<string, new (page: PageRecord, editMode: boolean, extension: string) => Page> = new Map()
  public components: Map<string, new (component: ComponentData, path: string, parent: Component, editMode: boolean, extension: string) => Component> = new Map()
  public cssblocks: Map<string, RegistryCSSBlock> = new Map()
  public jsblocks: Map<string, RegistryJSBlock> = new Map()
  public files: Map<string, RegistryFile> = new Map()
  public all = [] as (typeof Component | typeof Page)[]
  public sassincludes = new Map<string, RegistrySCSSInclude>()

  async addTemplate (template: typeof Component | typeof Page) {
    if (!template.templateKey) throw new Error(`template ${template.name} has undefined templateKey, that must be corrected`)
    template.prototype.fetchRichText = async function (text: string | undefined) {
      if (text) await (this.api as unknown as RenderingAPIClient).scanForLinks(text)
    }
    template.prototype.renderRichText = function (text: string | undefined, opts?: { headerLevel?: number, advanceHeader?: string | null }) {
      if (isBlank(text)) return ''
      text = replaceLinksInText(text, (this.api as unknown as RenderingAPIClient).resolvedLinks)
      const dom = parseDocument('<!DOCTYPE html><html><body>' + text + '</body></html>')
      const $ = cheerio.load(dom)
      const headerLevel = (opts?.headerLevel ?? (this.renderCtx.headerLevel as number) ?? 2) + (isNotBlank(opts?.advanceHeader) ? 1 : 0)
      const allHeaders = $('h1,h2,h3,h4,h5,h6')
      processHeaders(true, headerLevel, headerLevel - 1, 0, allHeaders, headerLevel)
      return $('body').html() ?? ''
    }
    template.prototype.renderRawHTML = function (text: string | undefined) {
      if (isBlank(text)) return ''
      const dom = parseDocument('<!DOCTYPE html><html><body>' + text + '</body></html>')
      const $ = cheerio.load(dom)
      return $('body').html() ?? ''
    }
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
        const finalBlock = block as RegistryJSBlock
        this.jsblocks.set(key, finalBlock)
        const js = finalBlock.js ?? readFileSync(finalBlock.path!, 'utf8')
        promises.push(transform(js, { minify: true, sourcemap: true, sourcefile: `${key}.js`, legalComments: 'none', format: finalBlock.nomodule ? undefined : 'esm' }).then(minified => {
          finalBlock.js = minified.code
          finalBlock.map = minified.map
          finalBlock.size = new Blob([finalBlock.js]).size
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
        this.files.set(key, { ...block as Required<FileDeclaration>, size: stat.size, extension: ext || undefined })

        // write back to the component's `webpaths` property so it will know where its files
        // live on the rendering server
        const webpath = `${process.env.RESOURCES_PREFIX ?? ''}/.resources/${resourceversion}/${key}${ext ? '.' + ext : ''}`
        template.webpaths.set(key, webpath)
      }
    }
    for (const [key, block] of template.cssBlocks.entries()) {
      const existing = this.cssblocks.get(key)
      versionWarning(existing, block, 'CSS', key)
      if (!existing || versionGreater(block.version, existing.version)) {
        const finalBlock = block as RegistryCSSBlock
        this.cssblocks.set(key, finalBlock)
        let css: string
        if (finalBlock.path) {
          finalBlock.sass ??= finalBlock.path.endsWith('.scss')
          css = readFileSync(finalBlock.path, 'utf8')
        } else {
          if (!finalBlock.css) throw new Error('CSS registered without either a path or string content. One or the other is required.')
          css = finalBlock.css
        }

        const fonts = new Map<string, { href: string, format: string }>()
        const matches = css.matchAll(/url\((.*?)\)\s+format\(['"](.*?)['"]\);/ig)
        for (const match of matches ?? []) {
          let href = match[1]
          if (this.files.has(match[1])) {
            href = template.webpaths.get(href)!
            css = css.replace(new RegExp('url\\(' + match[1] + '\\)'), `url(${href})`)
          }
          if (match[2] === 'woff2') fonts.set(href, { href, format: 'font/woff2' })
        }
        finalBlock.fontfiles = Array.from(fonts.values())

        if (finalBlock.sass) {
          const compiled = sass.compileString(css, { sourceMap: true, sourceMapIncludeSources: true, importer })
          compiled.sourceMap!.file = `${key}.scss`
          compiled.sourceMap!.sources = [`${key}.scss`, ...compiled.sourceMap!.sources.slice(1).map(u => new URL(u).pathname.substring(1) + '.scss')]
          css = `${compiled.css}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(compiled.sourceMap), 'utf-8').toString('base64')} */`
        }
        promises.push(transform(css, { loader: 'css', minify: true, sourcemap: true, legalComments: 'none', sourcefile: `${key}.css` }).then(async minified => {
          finalBlock.css = minified.code
          finalBlock.map = minified.map
          finalBlock.size = new Blob([finalBlock.css]).size
        }))
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

  registerSass <T extends typeof ResourceProvider> (template: T) {
    for (const [key, block] of template.scssIncludes.entries()) {
      const existing = this.sassincludes.get(key)
      versionWarning(existing, block, 'SASS', key)
      if (!existing || versionGreater(block.version, existing.version)) {
        const finalBlock = block as RegistrySCSSInclude
        finalBlock.scss = finalBlock.scss ?? readFileSync(finalBlock.path!, 'utf8')
        this.sassincludes.set(key, finalBlock)
      }
    }
  }
}

export const templateRegistry = new TemplateRegistry()
