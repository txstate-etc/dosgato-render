import { IncomingHttpHeaders } from 'http'
import { Component, PageRecord, ComponentData, LinkDefinition } from '@dosgato/templating'
import { templateRegistry } from './registry.js'
import { resourceversion } from './version.js'
import { RenderingAPIClient } from './api.js'

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
function executeSetContext (editMode: boolean) {
  const setContextFn = async (component: Component) => {
    const components = Array.from(component.areas.values()).flat()
    await Promise.all(components.map(async c => {
      try {
        if (!c.hadError) c.renderCtx = await c.setContext(component.renderCtx, editMode)
      } catch (e: any) {
        c.logError(e)
      }
      await setContextFn(c)
    }))
  }
  return setContextFn
}

// recursive helper function for the final render phase of rendering (phase 3)
function renderComponent (editMode: boolean) {
  const renderFn = (component: Component) => {
    if (component.hadError) return editMode ? 'There was an error rendering a component here.' : ''
    const renderedAreas = new Map<string, string[]>()
    for (const [key, list] of component.areas) {
      const areaList = list.map(renderFn)
      renderedAreas.set(key, areaList)
    }
    try {
      return component.render(renderedAreas, editMode)
    } catch (e: any) {
      component.logError(e)
      return editMode ? 'There was an error rendering a component here.' : ''
    }
  }
  return renderFn
}

// recursive helper function for rendering a variation of a page
function renderVariation (extension: string) {
  const renderFn = (component: Component) => {
    if (component.hadError) return ''
    const renderedAreas = new Map<string, string>()
    for (const [key, list] of component.areas) {
      const areaList = list.map(renderFn)
      renderedAreas.set(key, areaList.join(''))
    }
    try {
      return component.renderVariation(extension, renderedAreas)
    } catch (e: any) {
      component.logError(e)
      return ''
    }
  }
  return renderFn
}

// recursive helper function for transformation of plain-object componentData
// into a hydrated instance of the Component class (or a descendent class like Page)
function hydrateComponent (componentData: ComponentData, parent: Component, path: string) {
  // find the page implementation in the registry
  const ComponentType = templateRegistry.components.get(componentData.templateKey)
  if (!ComponentType) {
    console.warn(`Template ${componentData.templateKey} is in the page data at ${path} but no template code has been registered for it.`)
    return undefined
  }

  // hydrate the page data into full objects
  const component = new ComponentType(componentData, path, parent)
  for (const key of Object.keys(componentData.areas ?? {})) {
    const areaComponents: Component[] = []
    for (let i = 0; i < componentData.areas![key].length; i++) {
      const child = hydrateComponent(componentData.areas![key][i], component, `${path}.areas.${key}.${i}`)
      if (child) areaComponents.push(child)
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
function hydratePage (pageData: PageRecord) {
  // find the page implementation in the registry
  const PageType = templateRegistry.pages.get(pageData.data.templateKey)
  if (!PageType) throw new Error('Unable to render page. Missing template implementation.')

  // hydrate the page data into full objects
  const page = new PageType(pageData)
  for (const key of Object.keys(pageData.data.areas ?? {})) {
    const areaComponents: Component[] = []
    for (let i = 0; i < pageData.data.areas![key].length; i++) {
      const child = hydrateComponent(pageData.data.areas![key][i], page, `areas.${key}.${i}`)
      if (child) areaComponents.push(child)
    }
    page.areas.set(key, areaComponents)
  }
  return page
}

function editModeIncludes () {
  return '<script src="/.editing/edit.js" async></script><link rel="stylesheet" href="/.editing/edit.css">'
}

/**
 * This function represents the entire rendering process. It takes a non-hydrated page (plus
 * the non-hydrated data for its ancestors, to support inheritance) and returns an HTML
 * string.
 *
 * Any migrations should be completed before rendering a page. They probably already happened
 * in the API Server.
 */
export async function renderPage (api: RenderingAPIClient, requestHeaders: IncomingHttpHeaders, page: PageRecord, extension = 'html', editMode = false) {
  const pageComponent = hydratePage(page)
  const componentsIncludingPage = collectComponents(pageComponent)

  // execute the fetch phase
  await Promise.all(componentsIncludingPage.map(async c => {
    try {
      c.fetched = await c.fetch(editMode)
    } catch (e: any) {
      c.logError(e)
    }
  }))

  // if this is a variation, go ahead and render after the fetch phase
  if (extension && extension !== 'html') {
    return renderVariation(extension)(pageComponent)
  }

  // execute the context phase
  pageComponent.renderCtx = await pageComponent.setContext({ headerLevel: 1, requestHeaders }, editMode)
  await executeSetContext(editMode)(pageComponent)

  // provide content for the <head> element and give it to the page component
  const fontfiles = new Map<string, { href: string, format: string }>()
  const cssBlockNames = Array.from(new Set(componentsIncludingPage.flatMap(r => r.cssBlocks())))
  const cssBlocks = cssBlockNames.map(name => ({ name, block: templateRegistry.cssblocks.get(name) })).filter(({ block }) => block != null)
  for (const { block } of cssBlocks) {
    for (const fontfile of block!.fontfiles ?? []) fontfiles.set(fontfile.href, fontfile)
  }
  pageComponent.headContent = (editMode ? editModeIncludes() : '') + [
    ...cssBlocks.map(({ name, block }) =>
      `<link rel="stylesheet" href="/.resources/${resourceversion}/${name}.css"${block!.async ? ' media="print" onload="this.media=all"' : ''}>`
    ),
    ...Array.from(fontfiles.values()).map(ff =>
      `<link rel="preload" as="font" href="${ff.href}" type="${ff.format}" crossorigin="anonymous">`
    ),
    ...Array.from(new Set(componentsIncludingPage.flatMap(r => r.jsBlocks()))).map(name => ({ name, block: templateRegistry.jsblocks.get(name) })).filter(({ name, block }) => block != null).map(({ name, block }) =>
      `<script src="/.resources/${resourceversion}/${name}.js"${block!.async ? ' async' : ' defer'}></script>`)
  ].join('\n')
  // execute the render phase
  return renderComponent(editMode)(pageComponent)
}
