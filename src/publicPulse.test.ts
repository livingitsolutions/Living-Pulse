import { describe, expect, it } from 'vitest'
import { publicPulsePath, publicPulseUrl } from './publicPulse'

describe('public Pulse URLs', () => {
  it('builds only the respondent route', () => {
    expect(publicPulsePath('pulse-id')).toBe('/p/pulse-id')
    expect(publicPulseUrl('https://livingpulse.example', 'pulse-id')).toBe('https://livingpulse.example/p/pulse-id')
    expect(publicPulseUrl('https://livingpulse.example', 'pulse-id')).not.toContain('key')
    expect(publicPulseUrl('https://livingpulse.example', 'pulse-id')).not.toContain('#')
  })
})
