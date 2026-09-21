import { and, count, eq } from 'drizzle-orm'
import { db } from './index.js'
import { acquisitionAuditEvents, acquisitionOutreachAttempts, acquisitionProspects, acquisitionSuppressions } from './schema.js'
import type { Prospect, SuppressionReason } from '../src/acquisitionFoundation.js'
import type { AuditName, ProspectStore, ProspectTransaction, StoredProspect } from '../src/prospectServices.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const stored = (row: typeof acquisitionProspects.$inferSelect): StoredProspect => ({
  id: row.id,
  businessName: row.businessName,
  websiteUrl: row.websiteUrl,
  publicContactEmail: row.publicContactEmail,
  normalizedEmail: row.normalizedEmail,
  industry: row.industry,
  locationText: row.locationText,
  sourceUrl: row.sourceUrl,
  sourceType: row.sourceType as StoredProspect['sourceType'],
  sourceObservedAt: row.sourceObservedAt,
  qualificationStatus: row.qualificationStatus as StoredProspect['qualificationStatus'],
  rejectionReason: row.rejectionReason,
  outreachStatus: row.outreachStatus as StoredProspect['outreachStatus'],
  personalizationContext: row.personalizationContext,
  personalizationEvidence: row.personalizationEvidence,
})

function transactionAdapter(tx: Transaction): ProspectTransaction {
  return {
    async findProspect(id) {
      const [row] = await tx.select().from(acquisitionProspects).where(eq(acquisitionProspects.id, id)).limit(1).for('update')
      return row ? stored(row) : null
    },
    async findProspectByEmail(normalizedEmail) {
      const [row] = await tx.select().from(acquisitionProspects).where(eq(acquisitionProspects.normalizedEmail, normalizedEmail)).limit(1)
      return row ? stored(row) : null
    },
    async insertProspect(prospect: Prospect) {
      const [row] = await tx.insert(acquisitionProspects).values({ ...prospect, id: undefined }).returning()
      return stored(row)
    },
    async updateProspect(id, changes) {
      const [row] = await tx.update(acquisitionProspects).set({
        qualificationStatus: changes.qualificationStatus,
        rejectionReason: changes.rejectionReason,
        outreachStatus: changes.outreachStatus,
        updatedAt: new Date(),
      }).where(eq(acquisitionProspects.id, id)).returning()
      return stored(row)
    },
    async isSuppressed(normalizedEmail) {
      const [row] = await tx.select({ normalizedEmail: acquisitionSuppressions.normalizedEmail }).from(acquisitionSuppressions).where(eq(acquisitionSuppressions.normalizedEmail, normalizedEmail)).limit(1)
      return Boolean(row)
    },
    async insertSuppression(normalizedEmail, reason: SuppressionReason) {
      const rows = await tx.insert(acquisitionSuppressions).values({ normalizedEmail, reason }).onConflictDoNothing().returning({ normalizedEmail: acquisitionSuppressions.normalizedEmail })
      return rows.length === 1
    },
    async countAttempts(prospectId) {
      const [row] = await tx.select({ value: count() }).from(acquisitionOutreachAttempts).where(eq(acquisitionOutreachAttempts.prospectId, prospectId))
      return row.value
    },
    async insertAttempt(prospectId, sequenceNumber) {
      const [row] = await tx.insert(acquisitionOutreachAttempts).values({ prospectId, sequenceNumber, status: 'queued' }).returning({ id: acquisitionOutreachAttempts.id })
      return row
    },
    async insertAudit(name: AuditName, prospectId, attemptId, metadata) {
      await tx.insert(acquisitionAuditEvents).values({ name, prospectId, attemptId, metadata })
    },
  }
}

export const prospectStore: ProspectStore = {
  transaction: (operation) => db.transaction((tx) => operation(transactionAdapter(tx))),
  async findProspectByEmail(normalizedEmail) {
    const [row] = await db.select().from(acquisitionProspects).where(and(eq(acquisitionProspects.normalizedEmail, normalizedEmail))).limit(1)
    return row ? stored(row) : null
  },
}
