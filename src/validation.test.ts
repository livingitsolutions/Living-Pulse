import { describe, expect, it } from 'vitest'
import { hasEnoughOptions, percentage } from './validation'

describe('Pulse validation', () => {
  it('requires two non-empty response options', () => {
    expect(hasEnoughOptions([{ id: 'a', label: 'Yes' }, { id: 'b', label: '  ' }])).toBe(false)
    expect(hasEnoughOptions([{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }])).toBe(true)
  })

  it('calculates rounded distributions and handles no responses', () => {
    expect(percentage(1, 3)).toBe(33)
    expect(percentage(0, 0)).toBe(0)
  })
})
