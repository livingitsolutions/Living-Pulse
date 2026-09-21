export const ACQUISITION_KEY = 'living-pulse-acquisition'

export type AcquisitionAttribution = {
  source: 'powered_by'
  sourcePulseId: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function poweredByPath(sourcePulseId: string) {
  const params = new URLSearchParams({ source: 'powered_by', sourcePulseId })
  return `/create?${params.toString()}`
}

export function parseAttribution(value: unknown): AcquisitionAttribution | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.source !== 'powered_by' || typeof candidate.sourcePulseId !== 'string' || !uuidPattern.test(candidate.sourcePulseId)) return null
  return { source: 'powered_by', sourcePulseId: candidate.sourcePulseId }
}

export function attributionFromSearch(search: string) {
  const params = new URLSearchParams(search)
  return parseAttribution({ source: params.get('source'), sourcePulseId: params.get('sourcePulseId') })
}

export function preserveAttribution(search: string, storage: StorageLike) {
  const incoming = attributionFromSearch(search)
  if (incoming) {
    storage.setItem(ACQUISITION_KEY, JSON.stringify(incoming))
    return incoming
  }
  try {
    return parseAttribution(JSON.parse(storage.getItem(ACQUISITION_KEY) || 'null'))
  } catch {
    return null
  }
}
