export function parsePath (path: string) {
  path = (path.startsWith('/') ? '' : '/') + (path.endsWith('/') ? path.substr(0, -1) : path)
  return {
    path: path.replace(/[^/]*\/\.\./, '').replace(/\/+/, '/').replace(/\.\w{1,12}$/i, ''),
    extension: path.includes('.') ? path.replace(/^.*?\.(\w{1,12})$/i, '$1') || undefined : undefined
  }
}
