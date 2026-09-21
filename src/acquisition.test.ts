import { describe, expect, it } from 'vitest'
import { ACQUISITION_KEY, attributionFromSearch, parseAttribution, poweredByPath, preserveAttribution } from './acquisition'

const pulseId = '123e4567-e89b-42d3-a456-426614174000'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('powered-by acquisition attribution', () => {
  it('generates and parses powered-by attribution', () => {
    const path = poweredByPath(pulseId)
    expect(path).toBe(`/create?source=powered_by&sourcePulseId=${pulseId}`)
    expect(attributionFromSearch(path.split('?')[1])).toEqual({ source: 'powered_by', sourcePulseId: pulseId })
  })

  it('preserves the acquisition source for the creation flow', () => {
    const storage = memoryStorage()
    expect(preserveAttribution(`?source=powered_by&sourcePulseId=${pulseId}`, storage)).toEqual({ source: 'powered_by', sourcePulseId: pulseId })
    expect(preserveAttribution('', storage)).toEqual({ source: 'powered_by', sourcePulseId: pulseId })
  })

  it('keeps notification email and response answers out of attribution metadata', () => {
    const unsafe = { source: 'powered_by', sourcePulseId: pulseId, email: 'private@example.com', optionId: 'answer-1', answer: 'Yes' }
    expect(parseAttribution(unsafe)).toEqual({ source: 'powered_by', sourcePulseId: pulseId })
    const storage = memoryStorage({ [ACQUISITION_KEY]: JSON.stringify(unsafe) })
    expect(preserveAttribution('', storage)).toEqual({ source: 'powered_by', sourcePulseId: pulseId })
  })

  it('rejects malformed or unsupported attribution', () => {
    expect(parseAttribution({ source: 'powered_by', sourcePulseId: 'not-a-uuid' })).toBeNull()
    expect(parseAttribution({ source: 'email', sourcePulseId: pulseId })).toBeNull()
  })
})
