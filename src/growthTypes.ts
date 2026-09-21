import type { OutreachStatus, QualificationStatus, SourceType, SuppressionReason } from './acquisitionFoundation'

export type GrowthOverview = {
  total: number
  pending: number
  qualified: number
  queued: number
  sent: number
  replied: number
  converted: number
  suppressed: number
  policy: { sendingEnabled: false; dailyLimit: 10; maximumAttempts: 2 }
}

export type GrowthProspectSummary = {
  id: string
  businessName: string
  industry: string | null
  locationText: string | null
  qualificationStatus: QualificationStatus
  outreachStatus: OutreachStatus
  attemptCount: number
  sourceType: SourceType
}

export type GrowthAttempt = {
  id: string
  businessName: string
  prospectId: string
  sequenceNumber: number
  status: 'queued' | 'sent' | 'cancelled'
  outreachStatus: OutreachStatus
  scheduledFor: string | null
  sentAt: string | null
}

export type GrowthSuppression = {
  businessName: string | null
  prospectId: string | null
  reason: SuppressionReason
  createdAt: string
}

export type GrowthProspectDetail = GrowthProspectSummary & {
  websiteUrl: string | null
  publicContactEmail: string
  sourceUrl: string
  sourceObservedAt: string
  evidenceNote: string
  potentialUseCase: string | null
  emailSourceUrl: string
  personalizationContext: string | null
  personalizationEvidence: string | null
  rejectionReason: string | null
  suppression: GrowthSuppression | null
  attempts: GrowthAttempt[]
  safety: {
    publicSourceEvidence: boolean
    validPublicEmail: boolean
    qualified: boolean
    notSuppressed: boolean
    attemptCapacity: boolean
  }
}
