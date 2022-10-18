import { Component, PageRecord, ComponentData, EditBarOpts, RenderedComponent, NewBarOpts } from '@dosgato/templating'
import { FastifyRequest, FastifyReply } from 'fastify'
import { ParsedUrlQuery } from 'querystring'
import { templateRegistry } from './registry.js'
import { resourceversion } from './version.js'
import { RenderingAPIClient } from './api.js'
import { randomid, htmlEncode } from 'txstate-utils'
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
function executeSetContext (editMode: boolean) {
  const setContextFn = async (component: Component) => {
    const components = Array.from(component.areas.values()).flat()
    await Promise.all(components.map(async c => {
      try {
        if (!c.hadError) c.renderCtx = await c.setContext(component.renderCtx)
      } catch (e: any) {
        c.logError(e)
      }
      await setContextFn(c)
    }))
  }
  return setContextFn
}

// recursive helper function for the final render phase of rendering (phase 3)
function renderComponent (component: Component) {
  if (component.hadError) return component.editMode ? 'There was an error rendering a component here.' : ''
  component.renderedAreas = new Map<string, RenderedComponent[]>()
  for (const [key, list] of component.areas) {
    const areaList = list.map(c => ({ output: renderComponent(c), component: c }))
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
function hydrateComponent (componentData: ComponentData, parent: Component, path: string, editMode: boolean) {
  // find the page implementation in the registry
  const ComponentType = templateRegistry.components.get(componentData.templateKey)
  if (!ComponentType) {
    console.warn(`Template ${componentData.templateKey} is in the page data at ${path} but no template code has been registered for it.`)
    return undefined
  }

  // hydrate the page data into full objects
  const component = new ComponentType(componentData, path, parent, editMode)
  for (const key of Object.keys(componentData.areas ?? {})) {
    const areaComponents: Component[] = []
    for (let i = 0; i < componentData.areas![key].length; i++) {
      const child = hydrateComponent(componentData.areas![key][i], component, `${path}.areas.${key}.${i}`, editMode)
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
function hydratePage (pageData: PageRecord, editMode: boolean) {
  // find the page implementation in the registry
  const PageType = templateRegistry.pages.get(pageData.data.templateKey)
  if (!PageType) throw new Error('Unable to render page. Missing template implementation.')

  // hydrate the page data into full objects
  const page = new PageType(pageData, editMode)
  for (const key of Object.keys(pageData.data.areas ?? {})) {
    const areaComponents: Component[] = []
    for (let i = 0; i < pageData.data.areas![key].length; i++) {
      const child = hydrateComponent(pageData.data.areas![key][i], page, `areas.${key}.${i}`, editMode)
      if (child) areaComponents.push(child)
    }
    page.areas.set(key, areaComponents)
  }
  return page
}

function editModeIncludes () {
  return `<script src="/.editing/${resourceversion}/edit.js" defer></script><link rel="stylesheet" href="/.editing/${resourceversion}/edit.css">`
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
  const pageComponent = hydratePage(page, editMode)
  pageComponent.addHeader = (key: string, value: string | undefined) => {
    if (value != null) void res.header(key, value)
    else void res.removeHeader(key)
  }
  const componentsIncludingPage = collectComponents(pageComponent)

  const templateByKey = await api.getTemplates()
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
        registered.push({ area, components, mode, fromPageId })
      }
      c.fetched = await c.fetch()
      const extraComponents: Component[] = []
      for (const entry of registered) {
        if (!c.areas.has(entry.area)) c.areas.set(entry.area, [])
        const fromPageId = Array.isArray(entry.fromPageId) ? entry.fromPageId : Array(entry.components.length).fill(entry.fromPageId)
        for (let i = 0; i < entry.components.length; i++) {
          const cData = entry.components[i]
          const hydrated = hydrateComponent(cData, c, 'inherited', editMode)
          if (hydrated) {
            hydrated.inheritedFrom = fromPageId[i]
            extraComponents.push(hydrated)
            if (entry.mode === 'replace') c.areas.set(entry.area, [])
            if (entry.mode === 'top') c.areas.get(entry.area)!.unshift(hydrated)
            else c.areas.get(entry.area)!.push(hydrated)
          }
        }
      }
      componentsIncludingInherited.push(...extraComponents)
      await Promise.all(extraComponents.map(async c => { c.fetched = await c.fetch() }))
    } catch (e: any) {
      c.logError(e)
    }
  }))

  // if this is a variation, go ahead and render after the fetch phase
  if (extension !== 'html') {
    return renderVariation(extension, pageComponent)
  }

  // execute the context phase
  pageComponent.renderCtx = await pageComponent.setContext({ headerLevel: 1 })
  await executeSetContext(editMode)(pageComponent)

  // provide content for the <head> element and give it to the page component
  const fontfiles = new Map<string, { href: string, format: string }>()
  const cssBlockNames = Array.from(new Set(componentsIncludingInherited.flatMap(r => r.cssBlocks())))
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
    ...Array.from(new Set(componentsIncludingInherited.flatMap(r => r.jsBlocks()))).map(name => ({ name, block: templateRegistry.jsblocks.get(name) })).filter(({ name, block }) => block != null).map(({ name, block }) =>
      `<script src="/.resources/${resourceversion}/${name}.js"${block!.async ? ' async' : ' defer'}></script>`)
  ].join('\n')
  // execute the render phase
  return renderComponent(pageComponent)
}

const addIcon = '<svg version="2.0"><use href="#dg-ed-add"/></svg>'
const editIcon = '<svg version="2.0"><use href="#dg-ed-edit"/></svg>'
const moveIcon = '<svg version="2.0"><use href="#dg-ed-move"/></svg>'
const trashIcon = '<svg version="2.0"><use href="#dg-ed-trash"/></svg>'

Component.editBar = (path: string, opts: EditBarOpts) => {
  if (!opts.editMode) return ''
  const id = randomid()
  if (opts.inheritedFrom) {
    return `
<div class="dg-edit-bar dg-edit-bar-inherited ${opts.extraClass ?? ''}">
  <span id="${id}" class="dg-edit-bar-label">${htmlEncode(opts.label)}</span>
  <button role="link" onclick="dgEditing.jump('${opts.inheritedFrom}')>Jump to Original</button>
</div>
    `.trim()
  } else {
    return `
<div class="dg-edit-bar ${opts.extraClass ?? ''}" data-path="${htmlEncode(path)}" data-maxreached="${opts.disableDrop ? 'false' : 'true'}" draggable="true" onclick="dgEditing.select(event)" ondragstart="dgEditing.drag(event)" ondragend="dgEditing.dragend(event)" ondragenter="dgEditing.enter(event)" ondragleave="dgEditing.leave(event)" ondragover="dgEditing.over(event)" ondrop="dgEditing.drop(event)">
  <span id="${id}" class="dg-edit-bar-label">${htmlEncode(opts.label)}</span>
  <span class="dg-edit-bar-move">${moveIcon}</span>
  ${opts.hideEdit ? '' : `<button onclick="dgEditing.edit(event)" aria-describedby="${id}">${editIcon}</button>`}
  <button ${opts.disableDelete ? 'disabled ' : ''}onclick="dgEditing.del(event)" aria-describedby="${id}">${trashIcon}</button>
</div>
    `.trim()
  }
}

Component.newBar = (path: string, opts: NewBarOpts) => {
  if (!opts.editMode) return ''
  return `
<button onclick="dgEditing.create(event)" ${opts.disabled ? 'disabled ' : ''}class="dg-new-bar ${opts.extraClass ?? ''}" data-path="${htmlEncode(path)}" ondragenter="dgEditing.enter(event)" ondragleave="dgEditing.leave(event)" ondragover="dgEditing.over(event)" ondrop="dgEditing.drop(event)">
  ${addIcon}<span>${htmlEncode(opts.label)}</span>
</button>
  `.trim()
}
