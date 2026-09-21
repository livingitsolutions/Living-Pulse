import { describe, expect, it } from 'vitest'
import { creatorKeyFromLocation, privateResultsPath, publishedPath } from './creatorAccess'

describe('creator capability URLs', () => {
  it('keeps the capability in the URL fragment', () => {
    expect(privateResultsPath('pulse-id', 'private-key')).toBe('/results/pulse-id#key=private-key')
    expect(publishedPath('pulse-id', 'private-key')).toBe('/published/pulse-id#key=private-key')
  })

  it('reads current fragment links and legacy query links', () => {
    expect(creatorKeyFromLocation('', '#key=private-key')).toBe('private-key')
    expect(creatorKeyFromLocation('?key=legacy-key', '')).toBe('legacy-key')
  })
})
