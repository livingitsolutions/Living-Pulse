import { SOURCE_TYPES, type ProspectInput, type SourceType } from './acquisitionFoundation'

export const MAX_DISCOVERY_RESULTS = 10
export const DISCOVERY_TIMEOUT_MS = 8_000
const MAX_TEXT = 2_000
export const MAX_EVIDENCE_EXCERPT = 1_000

export type DiscoveryCriteria = { category: string; location: string; maxResults: number }
export type DiscoveryCandidate = {
  businessName: string
  industry?: string | null
  locationText?: string | null
  websiteUrl?: string | null
  sourceType: Exclude<SourceType, 'manual'>
  sourceUrl: string
  sourceObservedAt: string
  evidenceNote: string
  potentialUseCase?: string | null
  personalizationContext?: string | null
  personalizationEvidence?: string | null
  publicEmailEvidence: { email: string; sourceUrl: string; observedText: string }
}
export type DiscoveryResult = DiscoveryCandidate & { existingProspect: boolean }

export interface ProspectDiscoveryProvider {
  readonly id: string
  discover(criteria: DiscoveryCriteria, signal: AbortSignal): Promise<DiscoveryCandidate[]>
}

export class DiscoveryProviderUnavailableError extends Error {
  constructor() { super('Live public discovery is not configured. A supported public-web search provider and credential are required.') }
}

function bounded(value: unknown, label: string, required = false, maximum = MAX_TEXT) {
  if (value == null && !required) return ''
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > maximum) throw new Error(`${label} is invalid or exceeds the allowed length.`)
  return value.trim()
}

function unsafeHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

export function isSafePublicUrl(value: string) {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && Boolean(url.hostname) && !unsafeHostname(url.hostname)
  } catch { return false }
}

export function validateDiscoveryCriteria(value: unknown): DiscoveryCriteria {
  if (!value || typeof value !== 'object') throw new Error('Discovery criteria are required.')
  const criteria = value as Record<string, unknown>
  const category = bounded(criteria.category, 'Business category', true, 120)
  const location = bounded(criteria.location, 'Location', true, 160)
  const maxResults = criteria.maxResults
  if (!Number.isInteger(maxResults) || (maxResults as number) < 1 || (maxResults as number) > MAX_DISCOVERY_RESULTS) throw new Error('Maximum results must be an integer from 1 to 10.')
  return { category, location, maxResults: maxResults as number }
}

export function validateDiscoveryCandidate(value: DiscoveryCandidate): DiscoveryCandidate {
  if (!value || typeof value !== 'object') throw new Error('Malformed discovery candidate.')
  const businessName = bounded(value.businessName, 'Business name', true, 240)
  if (!SOURCE_TYPES.includes(value.sourceType) || !['business_website', 'public_business_directory', 'public_social_business_page'].includes(value.sourceType)) throw new Error('A valid public source type is required.')
  if (!isSafePublicUrl(value.sourceUrl)) throw new Error('A safe public HTTP(S) source URL is required.')
  const evidenceNote = bounded(value.evidenceNote, 'Public-source evidence note', true)
  if (!value.sourceObservedAt || Number.isNaN(new Date(value.sourceObservedAt).getTime())) throw new Error('A valid source observed timestamp is required.')
  const email = bounded(value.publicEmailEvidence?.email, 'Observed public business email', true, 320)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('An observed public business email is required for acquisition intake.')
  if (!isSafePublicUrl(value.publicEmailEvidence?.sourceUrl)) throw new Error('A safe public HTTP(S) source supporting the public email is required.')
  const observedText = bounded(value.publicEmailEvidence?.observedText, 'Email evidence excerpt', true, MAX_EVIDENCE_EXCERPT)
  if (!observedText.toLocaleLowerCase('en-US').includes(email.toLocaleLowerCase('en-US'))) throw new Error('Email evidence must contain the exact observed address; guessed emails are not accepted.')
  if (value.websiteUrl && !isSafePublicUrl(value.websiteUrl)) throw new Error('Website URL must be a safe public HTTP(S) URL.')
  if (value.personalizationEvidence && !isSafePublicUrl(value.personalizationEvidence)) throw new Error('Personalization evidence must use a safe public HTTP(S) URL.')
  if (value.personalizationContext?.trim() && !value.personalizationEvidence) throw new Error('Personalization requires a safe public HTTP(S) evidence URL.')
  return {
    ...value,
    businessName,
    industry: bounded(value.industry, 'Industry', false, 240) || null,
    locationText: bounded(value.locationText, 'Location', false, 320) || null,
    evidenceNote,
    potentialUseCase: bounded(value.potentialUseCase, 'Potential use case') || null,
    personalizationContext: bounded(value.personalizationContext, 'Personalization context') || null,
    websiteUrl: value.websiteUrl?.trim() || null,
    sourceUrl: value.sourceUrl.trim(),
    personalizationEvidence: value.personalizationEvidence?.trim() || null,
    publicEmailEvidence: { email, sourceUrl: value.publicEmailEvidence.sourceUrl.trim(), observedText },
  }
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
    evidenceNote: `${valid.evidenceNote}\nEmail evidence excerpt: ${valid.publicEmailEvidence.observedText}`,
    potentialUseCase: valid.potentialUseCase,
    personalizationContext: valid.personalizationContext ?? null,
    personalizationEvidence: valid.personalizationEvidence ?? null,
    industry: valid.industry,
    locationText: valid.locationText,
  }
}

export async function runDiscovery(provider: ProspectDiscoveryProvider, rawCriteria: unknown) {
  const criteria = validateDiscoveryCriteria(rawCriteria)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    const timeout = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Discovery provider timed out safely.')), { once: true }))
    const candidates = await Promise.race([provider.discover(criteria, controller.signal), timeout])
    if (!Array.isArray(candidates)) throw new Error('Discovery provider returned a malformed response.')
    return candidates.slice(0, criteria.maxResults).map(validateDiscoveryCandidate)
  } finally { clearTimeout(timer) }
}
