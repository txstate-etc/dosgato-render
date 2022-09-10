import { createSecretKey } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function parsePath (path: string) {
  path = path.trim().toLocaleLowerCase()
  path = (path.startsWith('/') ? '' : '/') + (path.endsWith('/') ? path.substring(0, path.length - 1) : path)
  return {
    path: path.replace(/[^/]*\/\.\./, '').replace(/\/+/, '/').replace(/\.\w{1,12}$/i, ''),
    extension: path.includes('.') ? path.replace(/^.*?\.(\w{1,12})$/i, '$1') || undefined : undefined
  }
}

/** This function removes the site name from the path since it will be replaced by the launched URL */
export function resolvePath (prefix: string | undefined, pagePath: string) {
  const [sitename, ...pagenames] = pagePath.split('/')
  prefix = prefix?.replace(/\/+$/, '')
  return [prefix ?? '', ...pagenames].join('/')
}

export function resolvePreviewPath (prefix: string | undefined, pagePath: string) {
  prefix = prefix?.replace(/\/+$/, '')
  return [prefix ?? '', pagePath].join('/')
}

export const jwtSignKey = createSecretKey(process.env.DOSGATO_RENDER_JWT_SECRET!, 'ascii')

export function getFilePath (importURL: string, relativePath: string) {
  return path.resolve(path.dirname(fileURLToPath(importURL)), relativePath)
}
