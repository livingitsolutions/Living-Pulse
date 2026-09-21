import { describe, expect, it } from 'vitest'
import { createProspectServices, type AuditName, type ProspectStore, type ProspectTransaction, type StoredProspect } from './prospectServices'
import type { Prospect, ProspectInput, SuppressionReason } from './acquisitionFoundation'

const input = (overrides: Partial<ProspectInput> = {}): ProspectInput => ({
  businessName: 'Public Coffee', publicContactEmail: ' Hello@PublicCoffee.example ', sourceUrl: 'https://publiccoffee.example/contact', sourceType: 'business_website', sourceObservedAt: new Date('2026-09-21T10:00:00Z'), personalizationContext: null, personalizationEvidence: null, ...overrides,
})

type State = { prospects: StoredProspect[]; suppressions: Map<string, SuppressionReason>; attempts: { id: string; prospectId: string; sequenceNumber: number }[]; audits: { name: AuditName; prospectId: string; attemptId?: string }[] }

function memoryStore(failAudit?: AuditName) {
  let state: State = { prospects: [], suppressions: new Map(), attempts: [], audits: [] }
  let serial = 0
  const adapter = (working: State): ProspectTransaction => ({
    findProspect: async (id) => working.prospects.find((value) => value.id === id) ?? null,
    findProspectByEmail: async (email) => working.prospects.find((value) => value.normalizedEmail === email) ?? null,
    insertProspect: async (prospect: Prospect) => { const saved = { ...prospect, id: `prospect-${++serial}` }; working.prospects.push(saved); return saved },
    updateProspect: async (id, changes) => { const index = working.prospects.findIndex((value) => value.id === id); working.prospects[index] = { ...working.prospects[index], ...changes }; return working.prospects[index] },
    isSuppressed: async (email) => working.suppressions.has(email),
    insertSuppression: async (email, reason) => { if (working.suppressions.has(email)) return false; working.suppressions.set(email, reason); return true },
    countAttempts: async (id) => working.attempts.filter((value) => value.prospectId === id).length,
    insertAttempt: async (prospectId, sequenceNumber) => { const attempt = { id: `attempt-${++serial}`, prospectId, sequenceNumber }; working.attempts.push(attempt); return attempt },
    insertAudit: async (name, prospectId, attemptId) => { if (name === failAudit) throw new Error('audit failed'); working.audits.push({ name, prospectId, attemptId }) },
  })
  const store: ProspectStore = {
    async transaction(operation) {
      const working = structuredClone(state)
      const result = await operation(adapter(working))
      state = working
      return result
    },
    findProspectByEmail: async (email) => state.prospects.find((value) => value.normalizedEmail === email) ?? null,
  }
  return { services: createProspectServices(store), state: () => state }
}

async function created(setup: ReturnType<typeof memoryStore>) { return setup.services.createProspect(input()) }

describe('prospect application services', () => {
  it('creates pending/not-contacted prospects and the audit atomically', async () => {
    const setup = memoryStore(); const prospect = await created(setup)
    expect(prospect).toMatchObject({ normalizedEmail: 'hello@publiccoffee.example', qualificationStatus: 'pending', outreachStatus: 'not_contacted' })
    expect(setup.state().audits.map((event) => event.name)).toEqual(['prospect_created'])
  })
  it('rejects duplicate normalized email, missing evidence, and invalid email', async () => {
    const setup = memoryStore(); await created(setup)
    await expect(setup.services.createProspect(input({ publicContactEmail: 'HELLO@PUBLICCOFFEE.EXAMPLE' }))).rejects.toThrow(/already exists/i)
    await expect(setup.services.createProspect(input({ sourceUrl: '' }))).rejects.toThrow(/source evidence/i)
    await expect(setup.services.createProspect(input({ publicContactEmail: 'invalid' }))).rejects.toThrow(/valid publicly/i)
  })
  it('rolls back creation when its audit fails', async () => {
    const setup = memoryStore('prospect_created')
    await expect(created(setup)).rejects.toThrow('audit failed')
    expect(setup.state().prospects).toHaveLength(0)
  })
  it('qualifies only pending prospects and rolls back on audit failure', async () => {
    const setup = memoryStore(); const prospect = await created(setup)
    await expect(setup.services.qualifyProspect(prospect.id)).resolves.toMatchObject({ qualificationStatus: 'qualified' })
    await expect(setup.services.qualifyProspect(prospect.id)).rejects.toThrow(/invalid qualification/i)
    const failing = memoryStore('prospect_qualified'); const pending = await created(failing)
    await expect(failing.services.qualifyProspect(pending.id)).rejects.toThrow('audit failed')
    expect(failing.state().prospects[0].qualificationStatus).toBe('pending')
  })
  it('requires a rejection reason and atomically rejects pending prospects', async () => {
    const setup = memoryStore(); const prospect = await created(setup)
    await expect(setup.services.rejectProspect(prospect.id, '')).rejects.toThrow(/reason/i)
    await expect(setup.services.rejectProspect(prospect.id, 'Outside target')).resolves.toMatchObject({ qualificationStatus: 'rejected', rejectionReason: 'Outside target' })
    expect(setup.state().audits.at(-1)?.name).toBe('prospect_rejected')
    const failing = memoryStore('prospect_rejected'); const pending = await created(failing)
    await expect(failing.services.rejectProspect(pending.id, 'Outside target')).rejects.toThrow('audit failed')
    expect(failing.state().prospects[0].qualificationStatus).toBe('pending')
  })
  it('suppresses transactionally, stays suppressed, and is safely repeatable', async () => {
    const setup = memoryStore(); const prospect = await created(setup)
    await setup.services.suppressProspect(prospect.id, 'manual')
    await setup.services.suppressProspect(prospect.id, 'manual')
    expect(setup.state().suppressions.size).toBe(1)
    expect(setup.state().prospects[0].outreachStatus).toBe('suppressed')
    expect(setup.state().audits.filter((event) => event.name === 'prospect_suppressed')).toHaveLength(1)
    await expect(setup.services.queueProspect(prospect.id)).rejects.toThrow(/suppressed/i)
    const failing = memoryStore('prospect_suppressed'); const unsuppressed = await created(failing)
    await expect(failing.services.suppressProspect(unsuppressed.id, 'manual')).rejects.toThrow('audit failed')
    expect(failing.state().suppressions.size).toBe(0)
    expect(failing.state().prospects[0].outreachStatus).toBe('not_contacted')
  })
  it('queues a qualified prospect with sequence 1 and both audits atomically', async () => {
    const setup = memoryStore(); const prospect = await created(setup); await setup.services.qualifyProspect(prospect.id)
    await setup.services.queueProspect(prospect.id)
    expect(setup.state().attempts.map((attempt) => attempt.sequenceNumber)).toEqual([1])
    expect(setup.state().audits.slice(-2).map((event) => event.name)).toEqual(['prospect_queued', 'outreach_attempt_created'])
    await expect(setup.services.queueProspect(prospect.id)).rejects.toThrow(/already/i)
  })
  it('rejects queueing an unqualified prospect and rolls back all queue writes on audit failure', async () => {
    const setup = memoryStore(); const prospect = await created(setup)
    await expect(setup.services.queueProspect(prospect.id)).rejects.toThrow(/qualified/i)
    const failing = memoryStore('outreach_attempt_created'); const eligible = await created(failing); await failing.services.qualifyProspect(eligible.id)
    await expect(failing.services.queueProspect(eligible.id)).rejects.toThrow('audit failed')
    expect(failing.state().attempts).toHaveLength(0)
    expect(failing.state().prospects[0].outreachStatus).toBe('not_contacted')
    expect(failing.state().audits.some((event) => event.name === 'prospect_queued')).toBe(false)
  })
})

export { input, memoryStore }
