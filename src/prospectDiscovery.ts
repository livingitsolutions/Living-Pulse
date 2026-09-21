import { SOURCE_TYPES, type ProspectInput, type SourceType } from './acquisitionFoundation'

export type DiscoveryCriteria = { category: string; location: string; maximumResults?: number }

export type DiscoveryCandidate = {
  businessName: string
  industry?: string | null
  locationText?: string | null
  websiteUrl?: string | null
  sourceType: SourceType
  sourceUrl: string
  sourceObservedAt: string
  evidenceNote: string
  potentialUseCase?: string | null
  personalizationContext?: string | null
  personalizationEvidence?: string | null
  publicEmailEvidence: { email: string; sourceUrl: string; observedText: string }
}

export interface ProspectDiscoveryProvider {
  readonly id: string
  discover(criteria: DiscoveryCriteria): Promise<DiscoveryCandidate[]>
}

const publicUrl = (value: string) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

export function validateDiscoveryCandidate(value: DiscoveryCandidate): DiscoveryCandidate {
  if (!value.businessName?.trim()) throw new Error('Business name is required.')
  if (!SOURCE_TYPES.includes(value.sourceType)) throw new Error('A valid public source type is required.')
  if (!publicUrl(value.sourceUrl)) throw new Error('An HTTP(S) public source URL is required.')
  if (!value.evidenceNote?.trim()) throw new Error('A concise public-source evidence note is required.')
  if (!value.sourceObservedAt || Number.isNaN(new Date(value.sourceObservedAt).getTime())) throw new Error('A valid source observed timestamp is required.')
  const email = value.publicEmailEvidence?.email?.trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('An observed public business email is required for acquisition intake.')
  if (!publicUrl(value.publicEmailEvidence.sourceUrl)) throw new Error('An HTTP(S) source supporting the public email is required.')
  if (!value.publicEmailEvidence.observedText?.toLowerCase().includes(email.toLowerCase())) throw new Error('Email evidence must contain the exact observed address; guessed emails are not accepted.')
  if (value.personalizationContext?.trim() && (!value.personalizationEvidence || !publicUrl(value.personalizationEvidence))) throw new Error('Personalization requires an HTTP(S) public evidence URL.')
  return value
}

export function candidateToProspectInput(candidate: DiscoveryCandidate): ProspectInput {
  const valid = validateDiscoveryCandidate(candidate)
  return {
    businessName: valid.businessName,
    websiteUrl: valid.websiteUrl,
    publicContactEmail: valid.publicEmailEvidence.email,
    emailSourceUrl: valid.publicEmailEvidence.sourceUrl,
    sourceUrl: valid.sourceUrl,
    sourceType: valid.sourceType,
    sourceObservedAt: new Date(valid.sourceObservedAt),
    evidenceNote: valid.evidenceNote,
    potentialUseCase: valid.potentialUseCase,
    personalizationContext: valid.personalizationContext ?? null,
    personalizationEvidence: valid.personalizationEvidence ?? null,
    industry: valid.industry,
    locationText: valid.locationText,
  }
}

export class OperatorAssistedDiscoveryProvider implements ProspectDiscoveryProvider {
  readonly id = 'operator_assisted_manual'
  constructor(private readonly candidates: readonly DiscoveryCandidate[]) {}
  async discover(criteria: DiscoveryCriteria) {
    const maximum = Math.min(Math.max(criteria.maximumResults || 25, 1), 100)
    return this.candidates.slice(0, maximum).map(validateDiscoveryCandidate)
  }
}
