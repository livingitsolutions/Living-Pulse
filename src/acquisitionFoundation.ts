export const MAX_OUTREACH_ATTEMPTS = 2
export const INITIAL_DAILY_SEND_LIMIT = 10

export const SOURCE_TYPES = ['business_website', 'public_business_directory', 'public_social_business_page', 'manual'] as const
export type SourceType = typeof SOURCE_TYPES[number]
export type QualificationStatus = 'pending' | 'qualified' | 'rejected'
export type OutreachStatus = 'not_contacted' | 'queued' | 'sent' | 'replied' | 'converted' | 'suppressed'
export type SuppressionReason = 'unsubscribe' | 'bounce' | 'complaint' | 'manual' | 'invalid'

export type Prospect = {
  businessName: string
  publicContactEmail: string
  normalizedEmail: string
  sourceUrl: string
  sourceType: SourceType
  sourceObservedAt: Date
  qualificationStatus: QualificationStatus
  rejectionReason: string | null
  outreachStatus: OutreachStatus
  personalizationContext: string | null
  personalizationEvidence: string | null
}

export type ProspectInput = Omit<Prospect, 'normalizedEmail' | 'qualificationStatus' | 'rejectionReason' | 'outreachStatus'>

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const transitions: Record<OutreachStatus, readonly OutreachStatus[]> = {
  not_contacted: ['queued', 'suppressed'],
  queued: ['sent', 'suppressed'],
  sent: ['replied', 'suppressed'],
  replied: ['converted', 'suppressed'],
  converted: ['suppressed'],
  suppressed: [],
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function createProspect(input: ProspectInput): Prospect {
  const normalizedEmail = normalizeEmail(input.publicContactEmail)
  if (!emailPattern.test(normalizedEmail)) throw new Error('A valid publicly listed business email is required.')
  if (!isPublicSourceUrl(input.sourceUrl) || !input.sourceObservedAt || Number.isNaN(input.sourceObservedAt.getTime())) throw new Error('Public source evidence is required.')
  if (input.personalizationContext?.trim() && !input.personalizationEvidence?.trim()) throw new Error('Personalization facts require public evidence.')
  return { ...input, businessName: input.businessName.trim(), publicContactEmail: input.publicContactEmail.trim(), normalizedEmail, sourceUrl: input.sourceUrl.trim(), qualificationStatus: 'pending', rejectionReason: null, outreachStatus: 'not_contacted' }
}

function isPublicSourceUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function assertEmailAvailable(normalizedEmail: string, existingNormalizedEmails: readonly string[]) {
  if (existingNormalizedEmails.some((email) => normalizeEmail(email) === normalizeEmail(normalizedEmail))) throw new Error('A prospect with this public email already exists.')
}

export function qualify(current: QualificationStatus): QualificationStatus {
  if (current !== 'pending') throw new Error('Invalid qualification transition.')
  return 'qualified'
}

export function reject(current: QualificationStatus, reason: string) {
  if (current !== 'pending' || !reason.trim()) throw new Error('Invalid qualification transition or rejection reason.')
  return { qualificationStatus: 'rejected' as const, rejectionReason: reason.trim() }
}

export function isSendingEnabled(environment: Record<string, string | undefined> = {}) {
  return environment.ACQUISITION_SENDING_ENABLED === 'true'
}

export function assertQueueEligible(prospect: Prospect, suppressed: boolean, attemptCount: number) {
  if (suppressed || prospect.outreachStatus === 'suppressed') throw new Error('Suppressed addresses cannot be queued.')
  if (prospect.qualificationStatus !== 'qualified') throw new Error('Only qualified prospects can be queued.')
  if (!prospect.sourceUrl || !emailPattern.test(prospect.normalizedEmail)) throw new Error('Valid public source evidence and email are required.')
  if (attemptCount >= MAX_OUTREACH_ATTEMPTS) throw new Error('Maximum outreach attempts reached.')
  if (prospect.outreachStatus !== 'not_contacted' && prospect.outreachStatus !== 'sent') throw new Error('Prospect is already active or cannot be queued.')
}

export function transitionOutreach(current: OutreachStatus, next: OutreachStatus): OutreachStatus {
  if (!transitions[current].includes(next)) throw new Error(`Invalid outreach transition: ${current} -> ${next}`)
  return next
}

export function nextAttemptSequence(existingAttempts: number) {
  if (!Number.isInteger(existingAttempts) || existingAttempts < 0 || existingAttempts >= MAX_OUTREACH_ATTEMPTS) throw new Error('Maximum outreach attempts reached.')
  return existingAttempts + 1
}

export function addSuppression(email: string, reason: SuppressionReason) {
  const normalizedEmail = normalizeEmail(email)
  if (!emailPattern.test(normalizedEmail)) throw new Error('A valid email is required for suppression.')
  return { normalizedEmail, reason }
}
