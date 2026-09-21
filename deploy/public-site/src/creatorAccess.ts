export function creatorKeyFromLocation(search: string, hash: string) {
  return new URLSearchParams(hash.replace(/^#/, '')).get('key') || new URLSearchParams(search).get('key') || ''
}

export function privateResultsPath(id: string, key: string) {
  return `/results/${id}#key=${encodeURIComponent(key)}`
}

export function publishedPath(id: string, key: string) {
  return `/published/${id}#key=${encodeURIComponent(key)}`
}
