import { describe, expect, it } from 'vitest'
import { importProspects } from './prospectImport'
import { input, memoryStore } from './prospectServices.test'

const jsonRow = (overrides: Record<string, unknown> = {}) => ({ ...input(), sourceObservedAt: '2026-09-21T10:00:00Z', ...overrides })

describe('internal prospect import', () => {
  it('reports valid and invalid rows independently in dry-run with zero mutations', async () => {
    const setup = memoryStore()
    const report = await importProspects([jsonRow(), jsonRow({ businessName: '', publicContactEmail: 'bad' })], setup.services, true)
    expect(report.map((row) => row.status)).toEqual(['accepted', 'rejected'])
    expect(setup.state()).toMatchObject({ prospects: [], attempts: [], audits: [] })
  })
  it('reports database and in-file duplicates without mutating during dry-run', async () => {
    const setup = memoryStore(); await setup.services.createProspect(input())
    const before = structuredClone(setup.state())
    const report = await importProspects([jsonRow(), jsonRow({ publicContactEmail: 'NEW@example.com' }), jsonRow({ publicContactEmail: ' new@example.com ' })], setup.services, true)
    expect(report.map((row) => row.status)).toEqual(['rejected', 'accepted', 'rejected'])
    expect(setup.state()).toEqual(before)
  })
  it('persists accepted rows only in apply mode', async () => {
    const setup = memoryStore()
    const report = await importProspects([jsonRow(), jsonRow({ sourceUrl: '' })], setup.services, false)
    expect(report[0]).toMatchObject({ status: 'accepted', prospectId: expect.any(String) })
    expect(report[1].status).toBe('rejected')
    expect(setup.state().prospects).toHaveLength(1)
  })
})
