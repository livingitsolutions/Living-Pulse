import { describe, expect, it } from 'vitest'
import { candidateToProspectInput, OperatorAssistedDiscoveryProvider, validateDiscoveryCandidate, type DiscoveryCandidate, type ProspectDiscoveryProvider } from './prospectDiscovery'

const candidate = (overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate => ({
  businessName: 'Harbour Kitchen', industry: 'Restaurant', locationText: 'Bristol, UK', websiteUrl: 'https://harbour.example', sourceType: 'business_website', sourceUrl: 'https://harbour.example/contact', sourceObservedAt: '2026-09-21T10:00:00Z', evidenceNote: 'The contact page advertises dine-in and takeaway and lists bookings@harbour.example.', potentialUseCase: 'Potential Pulse: test customer interest in Sunday delivery.', personalizationContext: 'Advertises dine-in and takeaway.', personalizationEvidence: 'https://harbour.example/contact', publicEmailEvidence: { email: 'bookings@harbour.example', sourceUrl: 'https://harbour.example/contact', observedText: 'Business enquiries: bookings@harbour.example' }, ...overrides,
})

describe('prospect discovery boundary', () => {
  it('exposes a provider-neutral contract and an operator-assisted implementation', async () => {
    const provider: ProspectDiscoveryProvider = new OperatorAssistedDiscoveryProvider([candidate()])
    expect(provider.id).toBe('operator_assisted_manual')
    expect(await provider.discover({ category: 'Restaurant', location: 'Bristol', maximumResults: 1 })).toHaveLength(1)
  })
  it('requires public HTTP(S) source evidence and an evidence note', () => {
    expect(() => validateDiscoveryCandidate(candidate({ sourceUrl: 'file:///private' }))).toThrow(/HTTP\(S\)/i)
    expect(() => validateDiscoveryCandidate(candidate({ evidenceNote: '' }))).toThrow(/evidence note/i)
  })
  it('requires exact public email evidence and cannot guess an address', () => {
    expect(() => validateDiscoveryCandidate(candidate({ publicEmailEvidence: { email: 'info@harbour.example', sourceUrl: 'https://harbour.example/contact', observedText: 'Call our team' } }))).toThrow(/guessed emails/i)
    expect(() => validateDiscoveryCandidate(candidate({ publicEmailEvidence: { email: 'bookings@harbour.example', sourceUrl: 'javascript:bad', observedText: 'bookings@harbour.example' } }))).toThrow(/HTTP\(S\)/i)
  })
  it('converts only to pending/not-contacted intake input', () => {
    const prospect = candidateToProspectInput(candidate())
    expect(prospect).not.toHaveProperty('qualificationStatus')
    expect(prospect).not.toHaveProperty('outreachStatus')
    expect(prospect.emailSourceUrl).toBe('https://harbour.example/contact')
  })
})
