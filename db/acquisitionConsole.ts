import { count, eq } from 'drizzle-orm'
import { db } from './index.js'
import { acquisitionOutreachAttempts, acquisitionProspects, acquisitionSuppressions } from './schema.js'
import type { GrowthAttempt, GrowthProspectDetail, GrowthProspectSummary, GrowthSuppression } from '../src/growthTypes.js'
import type { OutreachStatus, QualificationStatus, SourceType, SuppressionReason } from '../src/acquisitionFoundation.js'

const iso = (value: Date | null) => value?.toISOString() ?? null

export const acquisitionConsoleRepository = {
  async listProspects(): Promise<GrowthProspectSummary[]> {
    const rows = await db.select({
      id: acquisitionProspects.id,
      businessName: acquisitionProspects.businessName,
      industry: acquisitionProspects.industry,
      locationText: acquisitionProspects.locationText,
      qualificationStatus: acquisitionProspects.qualificationStatus,
      outreachStatus: acquisitionProspects.outreachStatus,
      sourceType: acquisitionProspects.sourceType,
      attemptCount: count(acquisitionOutreachAttempts.id),
    }).from(acquisitionProspects).leftJoin(acquisitionOutreachAttempts, eq(acquisitionOutreachAttempts.prospectId, acquisitionProspects.id))
      .groupBy(acquisitionProspects.id)
      .orderBy(acquisitionProspects.createdAt)
    return rows.map((row) => ({ ...row, qualificationStatus: row.qualificationStatus as QualificationStatus, outreachStatus: row.outreachStatus as OutreachStatus, sourceType: row.sourceType as SourceType }))
  },

  async findProspect(id: string): Promise<GrowthProspectDetail | null> {
    const [prospect] = await db.select().from(acquisitionProspects).where(eq(acquisitionProspects.id, id)).limit(1)
    if (!prospect) return null
    const attempts = await db.select().from(acquisitionOutreachAttempts).where(eq(acquisitionOutreachAttempts.prospectId, id)).orderBy(acquisitionOutreachAttempts.sequenceNumber)
    const [suppression] = await db.select().from(acquisitionSuppressions).where(eq(acquisitionSuppressions.normalizedEmail, prospect.normalizedEmail)).limit(1)
    const attemptRows: GrowthAttempt[] = attempts.map((attempt) => ({ id: attempt.id, businessName: prospect.businessName, prospectId: id, sequenceNumber: attempt.sequenceNumber, status: attempt.status as GrowthAttempt['status'], outreachStatus: prospect.outreachStatus as OutreachStatus, scheduledFor: iso(attempt.scheduledFor), sentAt: iso(attempt.sentAt) }))
    const suppressionRow: GrowthSuppression | null = suppression ? { businessName: prospect.businessName, prospectId: id, reason: suppression.reason as SuppressionReason, createdAt: suppression.createdAt.toISOString() } : null
    const attemptCount = attempts.length
    return {
      id,
      businessName: prospect.businessName,
      websiteUrl: prospect.websiteUrl,
      publicContactEmail: prospect.publicContactEmail,
      industry: prospect.industry,
      locationText: prospect.locationText,
      sourceUrl: prospect.sourceUrl,
      sourceType: prospect.sourceType as SourceType,
      sourceObservedAt: prospect.sourceObservedAt.toISOString(),
      evidenceNote: prospect.evidenceNote,
      potentialUseCase: prospect.potentialUseCase,
      emailSourceUrl: prospect.emailSourceUrl,
      personalizationContext: prospect.personalizationContext,
      personalizationEvidence: prospect.personalizationEvidence,
      qualificationStatus: prospect.qualificationStatus as QualificationStatus,
      rejectionReason: prospect.rejectionReason,
      outreachStatus: prospect.outreachStatus as OutreachStatus,
      attemptCount,
      suppression: suppressionRow,
      attempts: attemptRows,
      safety: {
        publicSourceEvidence: /^https?:\/\//.test(prospect.sourceUrl),
        validPublicEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prospect.normalizedEmail),
        qualified: prospect.qualificationStatus === 'qualified',
        notSuppressed: !suppression && prospect.outreachStatus !== 'suppressed',
        attemptCapacity: attemptCount < 2,
      },
    }
  },

  async listAttempts(): Promise<GrowthAttempt[]> {
    const rows = await db.select({ attempt: acquisitionOutreachAttempts, businessName: acquisitionProspects.businessName, outreachStatus: acquisitionProspects.outreachStatus })
      .from(acquisitionOutreachAttempts).innerJoin(acquisitionProspects, eq(acquisitionProspects.id, acquisitionOutreachAttempts.prospectId))
      .orderBy(acquisitionOutreachAttempts.createdAt)
    return rows.map(({ attempt, businessName, outreachStatus }) => ({ id: attempt.id, businessName, prospectId: attempt.prospectId, sequenceNumber: attempt.sequenceNumber, status: attempt.status as GrowthAttempt['status'], outreachStatus: outreachStatus as OutreachStatus, scheduledFor: iso(attempt.scheduledFor), sentAt: iso(attempt.sentAt) }))
  },

  async listSuppressions(): Promise<GrowthSuppression[]> {
    const rows = await db.select({ suppression: acquisitionSuppressions, prospectId: acquisitionProspects.id, businessName: acquisitionProspects.businessName })
      .from(acquisitionSuppressions).leftJoin(acquisitionProspects, eq(acquisitionProspects.normalizedEmail, acquisitionSuppressions.normalizedEmail))
      .orderBy(acquisitionSuppressions.createdAt)
    return rows.map(({ suppression, prospectId, businessName }) => ({ businessName, prospectId, reason: suppression.reason as SuppressionReason, createdAt: suppression.createdAt.toISOString() }))
  },
}

export type AcquisitionConsoleRepository = typeof acquisitionConsoleRepository
