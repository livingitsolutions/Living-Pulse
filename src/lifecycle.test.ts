import { describe, expect, it } from 'vitest'
import { statusDescriptions, statusOptions } from './lifecycle'

describe('signal lifecycle copy', () => {
  it('describes every supported status', () => {
    expect(statusOptions).toEqual(['Draft', 'Testing', 'Planned', 'Coming Soon', 'Launched', 'Archived'])
    expect(statusOptions.every((status) => Boolean(statusDescriptions[status]))).toBe(true)
  })
})
