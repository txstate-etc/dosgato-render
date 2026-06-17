import { createSecretKey } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBlank, isNotBlank } from 'txstate-utils'
import { WASMagic } from 'wasmagic'

export function parsePath (path: string) {
  path = path.trim().toLocaleLowerCase()
  path = (path.startsWith('/') ? '' : '/') + (path.endsWith('/') ? path.substring(0, path.length - 1) : path)
  return {
    path: path.replace(/[^/]*\/\.\./, '').replace(/\/+/, '/').replace(/\.\w{1,12}$/i, ''),
    extension: path.includes('.') ? path.replace(/^.*?\.(\w{1,12})$/i, '$1') || undefined : undefined
  }
}

export function resolvePath (prefix: string | undefined, pagePath: string) {
  const pagenames = pagePath.split('/').filter(isNotBlank)
  prefix = prefix?.replace(/\/+$/, '')
  if (isBlank(prefix)) return '/' + pagenames.join('/')
  return [prefix, ...pagenames].join('/')
}

export function resolvePreviewPath (prefix: string | undefined, pagePath: string) {
  prefix = prefix?.replace(/\/+$/, '')
  return [prefix ?? '', pagePath].join('/')
}

export function shiftPath (p: string) {
  return '/' + p.split('/').filter(isNotBlank).slice(1).join('/')
}

const TRACKER_PARAMS = new Set([
  'gclid', 'gclsrc', 'gbraid', 'wbraid', 'dclid',
  'fbclid', 'msclkid', 'yclid', 'ttclid', 'twclid', 'li_fat_id',
  'mc_cid', 'mc_eid',
  '_ga', '_gl',
  'igshid', 's_kwcid'
])

// Strip known marketing/analytics tracker params from a query string while preserving
// the exact encoding and ordering of any pairs that survive
export function stripTrackerParams (search: string) {
  if (isBlank(search) || search === '?') return ''
  const query = search.startsWith('?') ? search.slice(1) : search
  const kept = query.split('&').filter(pair => {
    if (pair === '') return false
    const eq = pair.indexOf('=')
    const key = eq === -1 ? pair : pair.slice(0, eq)
    if (key.startsWith('utm_')) return false
    return !TRACKER_PARAMS.has(key)
  })
  return kept.length ? '?' + kept.join('&') : ''
}

export const jwtSignKey = createSecretKey(process.env.DOSGATO_RENDER_JWT_SECRET!, 'ascii')

export function getFilePath (importURL: string, relativePath: string) {
  return path.resolve(path.dirname(fileURLToPath(importURL)), relativePath)
}

const wasmagic = await WASMagic.create()
export async function detectMimeType (filePath: string) {
  const input = createReadStream(filePath)
  let buf: Buffer | undefined
  for await (const chunk of input) {
    if (buf == null) buf = chunk
    else buf = Buffer.concat([buf, chunk])
    if (buf!.length > 1024) {
      const mimeType = wasmagic.detect(buf!)
      if (mimeType !== 'application/x-ole-storage') {
        input.destroy()
        return mimeType
      }
    }
    if (buf!.length > 20480000) { // 20MB
      input.destroy()
    }
  }
  return 'application/octet-stream'
}
