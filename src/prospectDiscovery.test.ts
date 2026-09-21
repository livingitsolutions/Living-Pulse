import { describe, expect, it, vi } from 'vitest'
import { candidateToProspectInput, DiscoveryProviderUnavailableError, isSafePublicUrl, runDiscovery, validateDiscoveryCandidate, validateDiscoveryCriteria, type DiscoveryCandidate, type ProspectDiscoveryProvider } from './prospectDiscovery'

const candidate = (overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate => ({
  businessName: 'Harbour Kitchen', industry: 'Restaurant', locationText: 'Bristol, UK', websiteUrl: 'https://harbour.example', sourceType: 'business_website', sourceUrl: 'https://harbour.example/contact', sourceObservedAt: '2026-09-21T10:00:00Z', evidenceNote: 'The contact page advertises dine-in and takeaway.', potentialUseCase: 'Could test customer interest in a delivery option.', personalizationContext: 'Advertises dine-in and takeaway.', personalizationEvidence: 'https://harbour.example/contact', publicEmailEvidence: { email: 'bookings@harbour.example', sourceUrl: 'https://harbour.example/contact', observedText: 'Business enquiries: bookings@harbour.example' }, ...overrides,
})

const provider = (values: DiscoveryCandidate[] = [candidate()]): ProspectDiscoveryProvider => ({ id: 'test_public_search', discover: vi.fn(async () => values) })

describe('prospect discovery boundary', () => {
  it('validates required criteria and enforces the hard result limit', () => {
    expect(validateDiscoveryCriteria({ category: 'Restaurant', location: 'Bristol', maxResults: 10 })).toMatchObject({ maxResults: 10 })
    for (const criteria of [{ category: '', location: 'Bristol', maxResults: 1 }, { category: 'Restaurant', location: '', maxResults: 1 }, { category: 'Restaurant', location: 'Bristol', maxResults: 11 }, { category: 'Restaurant', location: 'Bristol', maxResults: 1.5 }]) expect(() => validateDiscoveryCriteria(criteria)).toThrow()
  })

  it('runs a provider-neutral contract, bounds results, and permits zero results', async () => {
    expect(await runDiscovery(provider([]), { category: 'Restaurant', location: 'Bristol', maxResults: 3 })).toEqual([])
    expect(await runDiscovery(provider(Array(12).fill(candidate())), { category: 'Restaurant', location: 'Bristol', maxResults: 2 })).toHaveLength(2)
  })

  it('fails safely when the provider is unavailable', async () => {
    const unavailable: ProspectDiscoveryProvider = { id: 'none', discover: async () => { throw new DiscoveryProviderUnavailableError() } }
    await expect(runDiscovery(unavailable, { category: 'Restaurant', location: 'Bristol', maxResults: 1 })).rejects.toThrow(/not configured/i)
  })

  it('rejects malformed, non-public, and unsafe evidence URLs', () => {
    for (const url of ['file:///private', 'http://localhost/contact', 'http://127.0.0.1', 'http://10.1.2.3', 'http://169.254.1.1', 'http://[::1]/']) expect(isSafePublicUrl(url)).toBe(false)
    expect(() => validateDiscoveryCandidate(candidate({ sourceUrl: 'http://192.168.1.2' }))).toThrow(/safe public/i)
    expect(() => validateDiscoveryCandidate(candidate({ evidenceNote: '' }))).toThrow(/evidence note/i)
    expect(() => validateDiscoveryCandidate(candidate({ sourceObservedAt: 'not-a-date' }))).toThrow(/timestamp/i)
  })

  it('requires the exact published mailbox while accepting casing-only differences', () => {
    expect(() => validateDiscoveryCandidate(candidate({ publicEmailEvidence: { email: 'info@harbour.example', sourceUrl: 'https://harbour.example/contact', observedText: 'Call our team' } }))).toThrow(/guessed emails/i)
    expect(validateDiscoveryCandidate(candidate({ publicEmailEvidence: { email: 'bookings@harbour.example', sourceUrl: 'https://harbour.example/contact', observedText: 'Contact Bookings@Harbour.Example today' } })).publicEmailEvidence.observedText).toBe('Contact Bookings@Harbour.Example today')
    expect(() => validateDiscoveryCandidate(candidate({ publicEmailEvidence: { email: 'info@harbour.example', sourceUrl: 'https://harbour.example/contact', observedText: 'contact@harbour.example' } }))).toThrow(/guessed emails/i)
    expect(() => validateDiscoveryCandidate(candidate({ publicEmailEvidence: { email: 'bookings@harbour.example', sourceUrl: '', observedText: 'bookings@harbour.example' } }))).toThrow(/supporting/i)
  })

  it('retains bounded email provenance in pending/not-contacted intake input', () => {
    const prospect = candidateToProspectInput(candidate())
    expect(prospect).not.toHaveProperty('qualificationStatus')
    expect(prospect).not.toHaveProperty('outreachStatus')
    expect(prospect.evidenceNote).toContain('bookings@harbour.example')
    expect(prospect.emailSourceUrl).toBe('https://harbour.example/contact')
  })
})
