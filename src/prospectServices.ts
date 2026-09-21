import { addSuppression, assertEmailAvailable, assertQueueEligible, createProspect as validateProspect, normalizeBusinessIdentity, normalizeEmail, normalizeWebsite, qualify, reject, transitionOutreach, type Prospect, type ProspectInput, type SuppressionReason } from './acquisitionFoundation'

export type StoredProspect = Prospect & { id: string }
export type AuditName = 'prospect_created' | 'prospect_qualified' | 'prospect_rejected' | 'prospect_queued' | 'prospect_suppressed' | 'outreach_attempt_created'

export interface ProspectTransaction {
  findProspect(id: string): Promise<StoredProspect | null>
  findProspectByEmail(normalizedEmail: string): Promise<StoredProspect | null>
  findProspectByWebsite(domain: string): Promise<StoredProspect | null>
  findProspectByIdentity(identity: string): Promise<StoredProspect | null>
  insertProspect(prospect: Prospect): Promise<StoredProspect>
  updateProspect(id: string, changes: Partial<StoredProspect>): Promise<StoredProspect>
  isSuppressed(normalizedEmail: string): Promise<boolean>
  insertSuppression(normalizedEmail: string, reason: SuppressionReason): Promise<boolean>
  countAttempts(prospectId: string): Promise<number>
  insertAttempt(prospectId: string, sequenceNumber: 1): Promise<{ id: string }>
  insertAudit(name: AuditName, prospectId: string, attemptId?: string, metadata?: Record<string, string | number | boolean>): Promise<void>
}

export interface ProspectStore {
  transaction<T>(operation: (tx: ProspectTransaction) => Promise<T>): Promise<T>
  findProspectByEmail(normalizedEmail: string): Promise<StoredProspect | null>
  findProspectByWebsite(domain: string): Promise<StoredProspect | null>
  findProspectByIdentity(identity: string): Promise<StoredProspect | null>
  isSuppressed(normalizedEmail: string): Promise<boolean>
}

function requiredProspect(value: StoredProspect | null) {
  if (!value) throw new Error('Prospect not found.')
  return value
}

export function createProspectServices(store: ProspectStore) {
  async function assertIntakeAvailable(prospect: Prospect) {
    assertEmailAvailable(prospect.normalizedEmail, (await store.findProspectByEmail(prospect.normalizedEmail)) ? [prospect.normalizedEmail] : [])
    if (await store.isSuppressed(prospect.normalizedEmail)) throw new Error('This public email is suppressed and cannot be imported.')
    const domain = normalizeWebsite(prospect.websiteUrl)
    if (domain && await store.findProspectByWebsite(domain)) throw new Error('A prospect with this website already exists.')
    if (await store.findProspectByIdentity(normalizeBusinessIdentity(prospect.businessName, prospect.locationText))) throw new Error('A prospect with this business identity already exists; review it manually.')
  }
  return {
    async validateCreate(input: ProspectInput) {
      const prospect = validateProspect(input)
      await assertIntakeAvailable(prospect)
      return prospect
    },
    async createProspect(input: ProspectInput) {
      const prospect = validateProspect(input)
      await assertIntakeAvailable(prospect)
      return store.transaction(async (tx) => {
        assertEmailAvailable(prospect.normalizedEmail, (await tx.findProspectByEmail(prospect.normalizedEmail)) ? [prospect.normalizedEmail] : [])
        if (await tx.isSuppressed(prospect.normalizedEmail)) throw new Error('This public email is suppressed and cannot be imported.')
        const domain = normalizeWebsite(prospect.websiteUrl)
        if (domain && await tx.findProspectByWebsite(domain)) throw new Error('A prospect with this website already exists.')
        if (await tx.findProspectByIdentity(normalizeBusinessIdentity(prospect.businessName, prospect.locationText))) throw new Error('A prospect with this business identity already exists; review it manually.')
        const saved = await tx.insertProspect(prospect)
        await tx.insertAudit('prospect_created', saved.id, undefined, { intake: 'discovery' })
        return saved
      })
    },
    async qualifyProspect(id: string) {
      return store.transaction(async (tx) => {
        const prospect = requiredProspect(await tx.findProspect(id))
        const saved = await tx.updateProspect(id, { qualificationStatus: qualify(prospect.qualificationStatus), rejectionReason: null })
        await tx.insertAudit('prospect_qualified', id)
        return saved
      })
    },
    async rejectProspect(id: string, reason: string) {
      return store.transaction(async (tx) => {
        const prospect = requiredProspect(await tx.findProspect(id))
        const outcome = reject(prospect.qualificationStatus, reason)
        const saved = await tx.updateProspect(id, outcome)
        await tx.insertAudit('prospect_rejected', id, undefined, { reason: outcome.rejectionReason })
        return saved
      })
    },
    async suppressProspect(id: string, reason: SuppressionReason) {
      return store.transaction(async (tx) => {
        const prospect = requiredProspect(await tx.findProspect(id))
        const suppression = addSuppression(prospect.normalizedEmail, reason)
        const created = await tx.insertSuppression(suppression.normalizedEmail, suppression.reason)
        const saved = prospect.outreachStatus === 'suppressed' ? prospect : await tx.updateProspect(id, { outreachStatus: transitionOutreach(prospect.outreachStatus, 'suppressed') })
        if (created || prospect.outreachStatus !== 'suppressed') await tx.insertAudit('prospect_suppressed', id, undefined, { reason })
        return saved
      })
    },
    async queueProspect(id: string) {
      return store.transaction(async (tx) => {
        const prospect = requiredProspect(await tx.findProspect(id))
        const attemptCount = await tx.countAttempts(id)
        assertQueueEligible(prospect, await tx.isSuppressed(normalizeEmail(prospect.normalizedEmail)), attemptCount)
        const saved = await tx.updateProspect(id, { outreachStatus: transitionOutreach(prospect.outreachStatus, 'queued') })
        const attempt = await tx.insertAttempt(id, 1)
        await tx.insertAudit('prospect_queued', id)
        await tx.insertAudit('outreach_attempt_created', id, attempt.id, { sequenceNumber: 1 })
        return { prospect: saved, attempt }
      })
    },
  }
}
