import { Component, type PageRecord, type ComponentData, type EditBarOpts, type RenderedComponent, type NewBarOpts, type ContextBase } from '@dosgato/templating'
import { type FastifyRequest, type FastifyReply } from 'fastify'
import { type ParsedUrlQuery } from 'querystring'
import { type RegistryCSSBlock, templateRegistry } from './registry.js'
import { resourceversion } from './version.js'
import { type RenderingAPIClient } from './api.js'
import { htmlEncode, clone } from 'txstate-utils'
import { mimeTypes } from './mimetypes.js'

// recursive helper function to traverse a hydrated page and return a flat array
// of Component instances
function collectComponents (component: Component) {
  const ret = [component] as Component<ComponentData>[]
  for (const areaList of component.areas.values()) {
    for (const component of areaList) {
      ret.push(...collectComponents(component))
    }
  }
  return ret
}

// recursive helper function for the context phase of rendering (phase 2)
async function executeSetContext (component: Component, renderCtx: any) {
  component.renderCtx = renderCtx
  for (const [areaName, components] of component.areas.entries()) {
    if (!component.hadError) {
      let renderCtxForArea: ContextBase
      try {
        renderCtxForArea = await component.setContext(clone(renderCtx), areaName)
        await Promise.all(components.map(async c => {
          await executeSetContext(c, renderCtxForArea)
        }))
      } catch (e: any) {
        component.logError(e)
      }
    }
  }
}

// recursive helper function for the final render phase of rendering (phase 3)
function renderComponent (component: Component) {
  if (component.hadError) return component.editMode ? 'There was an error rendering a component here.' : ''
  component.renderedAreas = new Map<string, RenderedComponent[]>()
  for (const [key, list] of component.areas) {
    const areaList = list.map((c, i) => ({ output: renderComponent(c), component: c }))
    component.renderedAreas.set(key, areaList)
  }
  try {
    return component.render()
  } catch (e: any) {
    component.logError(e)
    return component.editMode ? 'There was an error rendering a component here.' : ''
  }
}

// recursive helper function for rendering a variation of a page
function renderVariation (extension: string, component: Component) {
  if (component.hadError) return ''
  component.renderedAreas = new Map<string, RenderedComponent[]>()
  for (const [key, list] of component.areas) {
    const areaList = list.map(c => ({ output: renderVariation(extension, c), component: c }))
    component.renderedAreas.set(key, areaList)
  }
  try {
    return component.renderVariation(extension)
  } catch (e: any) {
    component.logError(e)
    return ''
  }
}

// recursive helper function for transformation of plain-object componentData
// into a hydrated instance of the Component class (or a descendent class like Page)
function hydrateComponent (componentData: ComponentData, parent: Component, path: string, editMode: boolean, inheritedFrom: string | undefined, extension: string, templateByKey: Record<string, { areas: { name: string }[] }>, recursiveInherit?: boolean) {
  // find the page implementation in the registry
  const ComponentType = templateRegistry.components.get(componentData.templateKey)
  if (!ComponentType) {
    console.warn(`Template ${componentData.templateKey} is in the page data at ${path} but no template code has been registered for it.`)
    return undefined
  }

  // hydrate the page data into full objects
  const component = new ComponentType(componentData, path, parent, editMode, extension)
  component.inheritedFrom = inheritedFrom
  if (recursiveInherit) component.editBar = () => ''
  if (inheritedFrom) component.newBar = () => ''
  for (const key of templateByKey[componentData.templateKey]?.areas?.map(a => a.name) ?? []) {
    const areaComponents: Component[] = []
    for (let i = 0; i < (componentData.areas?.[key]?.length ?? 0); i++) {
      const child = hydrateComponent(componentData.areas![key][i], component, `${path}.areas.${key}.${i}`, editMode, inheritedFrom, extension, templateByKey, !!inheritedFrom)
      if (child) {
        child.indexInArea = areaComponents.length
        areaComponents.push(child)
        child.siblings = areaComponents
      }
    }
    for (let i = 0; i < areaComponents.length; i++) {
      areaComponents[i].prevSibling = areaComponents[i - 1]
      areaComponents[i].nextSibling = areaComponents[i + 1]
    }
    component.areas.set(key, areaComponents)
  }
  return component
}

// transform plain-object page data into a hydrated instance of the Page class
// in other words, the input to this function is a raw JSON object, as received from the
// API, and the output is a Page object, containing many Component objects, all
// of which are ready with the properties and methods defined in the Component class,
// that support the rendering process
function hydratePage (pageData: PageRecord, editMode: boolean, extension: string, templateByKey: Record<string, { areas: { name: string }[] }>) {
  // find the page implementation in the registry
  const PageType = templateRegistry.pages.get(pageData.data.templateKey)
  if (!PageType) throw new Error('Unable to render page. Missing template implementation.')

  // hydrate the page data into full objects
  const page = new PageType(pageData, editMode, extension)
  for (const key of templateByKey[pageData.data.templateKey]?.areas?.map(a => a.name) ?? []) {
    const areaComponents: Component[] = []
    for (let i = 0; i < (pageData.data.areas?.[key]?.length ?? 0); i++) {
      const child = hydrateComponent(pageData.data.areas![key][i], page, `areas.${key}.${i}`, editMode, undefined, extension, templateByKey)
      if (child) {
        child.indexInArea = areaComponents.length
        areaComponents.push(child)
        child.siblings = areaComponents
      }
    }
    for (let i = 0; i < areaComponents.length; i++) {
      areaComponents[i].prevSibling = areaComponents[i - 1]
      areaComponents[i].nextSibling = areaComponents[i + 1]
    }
    page.areas.set(key, areaComponents)
  }
  return page
}

function editModeIncludes () {
  return `<link href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap" rel="stylesheet"><script src="/.editing/${resourceversion}/edit.js" type="module"></script><link rel="stylesheet" href="/.editing/${resourceversion}/edit.css">`
}

/**
 * This function represents the entire rendering process. It takes a non-hydrated page (plus
 * the non-hydrated data for its ancestors, to support inheritance) and returns an HTML
 * string.
 *
 * Any migrations should be completed before rendering a page. They probably already happened
 * in the API Server.
 */
export async function renderPage (api: RenderingAPIClient, req: FastifyRequest, res: FastifyReply, page: PageRecord, extension = 'html', editMode = false) {
  void res.type(mimeTypes[extension] ?? 'text/plain')
  const templateByKey = await api.getTemplates()
  const pageComponent = hydratePage(page, editMode, extension, templateByKey)
  pageComponent.logError = function (e: Error) {
    this.hadError = true
    req.log.error(`Unrecoverable issue occurred during render of ${this.pageInfo.path}. Page template threw the following error: ${e.stack ?? e.message}`)
  }
  ;(pageComponent as any).passError = function (e: Error, path: string) {
    req.log.warn(`Recoverable issue occured during render of ${this.pageInfo.path}. Component at ${path} threw the following error: ${e.stack ?? e.message}`)
  }

  pageComponent.url = new URL(req.url, `${req.protocol}://${req.hostname}`).pathname
  pageComponent.addHeader = (key: string, value: string | undefined) => {
    if (value != null) {
      void res.header(key, value)
      if (key === 'Location') void res.status(302)
    } else void res.removeHeader(key)
  }
  pageComponent.setStatus = (statusCode: number) => {
    void res.status(statusCode)
  }
  const componentsIncludingPage = collectComponents(pageComponent)

  pageComponent.templateProperties = templateByKey[pageComponent.data.templateKey]?.templateProperties

  // execute the fetch phase
  const componentsIncludingInherited = [...componentsIncludingPage]
  await Promise.all(componentsIncludingPage.map(async c => {
    try {
      c.api = api
      c.reqHeaders = req.headers
      c.reqQuery = req.query as ParsedUrlQuery
      c.autoLabel = templateByKey[c.data.templateKey]?.name
      const registered: { area: string, components: ComponentData[], mode: 'top' | 'bottom' | 'replace', fromPageId: string | string[] }[] = []
      c.registerInherited = (area, components, fromPageId, mode = 'top') => {
        if (components?.length) registered.push({ area, components, mode, fromPageId })
      }
      c.fetched = c.shouldFetchVariation(extension) ? await c.fetch() : {}
      const extraComponents: Component[] = []
      for (const entry of registered) {
        if (!c.areas.has(entry.area) || entry.mode === 'replace') c.areas.set(entry.area, [])
        const fromPageId = Array.isArray(entry.fromPageId) ? entry.fromPageId : Array(entry.components.length).fill(entry.fromPageId)
        for (let i = 0; i < entry.components.length; i++) {
          const cData = entry.components[i]
          const hydrated = hydrateComponent(cData, c, 'inherited', editMode, fromPageId[i], extension, templateByKey)
          if (hydrated) {
            const hydratedPlusSubComponents = collectComponents(hydrated)
            for (const c of hydratedPlusSubComponents) {
              c.api = api
              c.reqHeaders = req.headers
              c.reqQuery = req.query as ParsedUrlQuery
              c.autoLabel = templateByKey[c.data.templateKey]?.name
              c.registerInherited = () => {} // inherited components cannot inherit further components
            }
            extraComponents.push(...hydratedPlusSubComponents)
            if (entry.mode === 'top') c.areas.get(entry.area)!.splice(i, 0, hydrated)
            else c.areas.get(entry.area)!.push(hydrated)
          }
        }
      }
      componentsIncludingInherited.push(...extraComponents)
      await Promise.all(extraComponents.map(async c => {
        try {
          c.fetched = await c.fetch()
        } catch (e: any) {
          c.logError(e)
        }
      }))
    } catch (e: any) {
      c.logError(e)
    }
  }))
  if (pageComponent.hadError) {
    void res.status(500)
    return ''
  }

  // execute the context phase
  await executeSetContext(pageComponent, { headerLevel: 1 })

  // render variations and skip the regular render phase
  if (extension !== 'html') {
    return renderVariation(extension, pageComponent)
  }

  // provide content for the <head> element and give it to the page component
  const fontfiles = new Map<string, { href: string, format: string }>()
  const cssBlockNames = Array.from(new Set(componentsIncludingInherited.flatMap(r => r.cssBlocks())))
  const cssBlocks = cssBlockNames.map(name => ({ name, block: templateRegistry.cssblocks.get(name) })).filter(({ block }) => block != null) as { name: string, block: RegistryCSSBlock }[]
  const normalCssBlocks = cssBlocks.filter(b => !b.block.targetsEditBars)
  const editCssBlocks = cssBlocks.filter(b => b.block.targetsEditBars)
  for (const { block } of normalCssBlocks) {
    for (const fontfile of block.fontfiles ?? []) fontfiles.set(fontfile.href, fontfile)
  }
  pageComponent.headContent = (editMode ? editModeIncludes() + `<script>window.dgEditingBlocks = ${JSON.stringify(editCssBlocks.map(b => b.name))}</script>` : '') + [
    ...normalCssBlocks.map(({ name, block }) =>
      `<link rel="stylesheet" href="/.resources/${resourceversion}/${name}.css"${block.async ? ' media="print" onload="this.media=all"' : ''}>`
    ),
    ...Array.from(fontfiles.values()).map(ff =>
      `<link rel="preload" as="font" href="${ff.href}" type="${ff.format}" crossorigin="anonymous">`
    ),
    ...Array.from(new Set(componentsIncludingInherited.flatMap(r => r.jsBlocks()))).map(name => ({ name, block: templateRegistry.jsblocks.get(name) })).filter(({ name, block }) => block != null).map(({ name, block }) =>
      `<script src="/.resources/${resourceversion}/${name}.js"${block!.async ? ' async' : ''}${block!.nomodule ? '' : ' type="module"'}></script>`)
  ].join('\n')
  // execute the render phase
  const ret = renderComponent(pageComponent)
  if (pageComponent.hadError) void res.status(500)
  return ret
}

Component.editBar = (path: string, opts: EditBarOpts) => {
  if (!opts.editMode) return ''
  if (opts.inheritedFrom) {
    return `<dg-inherit-bar${opts.extraClass ? ` class="${opts.extraClass}"` : ''} label="${htmlEncode(opts.label)}" inherited-from="${htmlEncode(opts.inheritedFrom)}"></dg-inherit-bar>`
  } else {
    return `<dg-edit-bar${opts.hideEdit ? ' hide-edit' : ''}${opts.disableDelete ? ' disable-delete' : ''}${opts.extraClass ? ` class="${opts.extraClass}"` : ''} data-path="${htmlEncode(path)}" data-maxreached="${opts.disableDrop ? 'true' : 'false'}" label="${htmlEncode(opts.label)}"></dg-edit-bar>`
  }
}

Component.newBar = (path: string, opts: NewBarOpts) => {
  if (!opts.editMode) return ''
  return `<dg-new-bar data-disableaddtotop="${opts.disableAddToTop ?? false}" ${opts.disabled ? 'disabled ' : ''}class="${opts.extraClass ?? ''}" data-path="${htmlEncode(path)}" label="${htmlEncode(opts.label)}"></dg-new-bar>`
}
