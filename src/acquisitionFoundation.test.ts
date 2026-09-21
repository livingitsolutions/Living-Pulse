import { describe, expect, it } from 'vitest'
import { INITIAL_DAILY_SEND_LIMIT, MAX_OUTREACH_ATTEMPTS, addSuppression, assertEmailAvailable, assertQueueEligible, createProspect, isSendingEnabled, nextAttemptSequence, normalizeEmail, qualify, reject, transitionOutreach, type Prospect } from './acquisitionFoundation'

const input = (overrides: Partial<Parameters<typeof createProspect>[0]> = {}) => ({
  businessName: 'Public Coffee',
  publicContactEmail: ' Hello@PublicCoffee.example ',
  sourceUrl: 'https://publiccoffee.example/contact',
  sourceType: 'business_website' as const,
  sourceObservedAt: new Date('2026-09-21T10:00:00Z'),
  personalizationContext: null,
  personalizationEvidence: null,
  ...overrides,
})

const prospect = (overrides: Partial<Prospect> = {}) => ({ ...createProspect(input()), qualificationStatus: 'qualified' as const, ...overrides })

describe('prospect foundation', () => {
  it('creates a pending prospect from a valid public source and normalizes email', () => {
    const value = createProspect(input())
    expect(value.normalizedEmail).toBe('hello@publiccoffee.example')
    expect(value.qualificationStatus).toBe('pending')
    expect(value.outreachStatus).toBe('not_contacted')
  })
  it('rejects missing source evidence and invalid email', () => {
    expect(() => createProspect(input({ sourceUrl: '' }))).toThrow(/source evidence/i)
    expect(() => createProspect(input({ publicContactEmail: 'not-email' }))).toThrow(/valid publicly listed/i)
  })
  it('normalizes safely and rejects duplicate normalized emails', () => {
    expect(normalizeEmail(' SALES@EXAMPLE.COM ')).toBe('sales@example.com')
    expect(() => assertEmailAvailable('sales@example.com', [' SALES@EXAMPLE.COM '])).toThrow(/already exists/i)
  })
  it('stores supported personalization with evidence and permits generic fallback', () => {
    expect(createProspect(input({ personalizationContext: 'Independent café', personalizationEvidence: 'https://publiccoffee.example/about' })).personalizationContext).toBe('Independent café')
    expect(createProspect(input()).personalizationContext).toBeNull()
    expect(() => createProspect(input({ personalizationContext: 'Unsupported claim' }))).toThrow(/require public evidence/i)
  })
})

describe('qualification and outreach state machines', () => {
  it('allows pending qualification outcomes and rejects invalid transitions', () => {
    expect(qualify('pending')).toBe('qualified')
    expect(reject('pending', 'Outside target industry')).toEqual({ qualificationStatus: 'rejected', rejectionReason: 'Outside target industry' })
    expect(() => qualify('qualified')).toThrow(/invalid qualification/i)
  })
  it('allows only explicit outreach transitions', () => {
    expect(transitionOutreach('not_contacted', 'queued')).toBe('queued')
    expect(transitionOutreach('queued', 'sent')).toBe('sent')
    expect(transitionOutreach('sent', 'replied')).toBe('replied')
    expect(transitionOutreach('replied', 'converted')).toBe('converted')
    expect(() => transitionOutreach('not_contacted', 'sent')).toThrow(/invalid outreach/i)
  })
  it('rejects queueing for unqualified, suppressed, or already active prospects', () => {
    expect(() => assertQueueEligible(prospect({ qualificationStatus: 'pending' }), false, 0)).toThrow(/qualified/i)
    expect(() => assertQueueEligible(prospect(), true, 0)).toThrow(/suppressed/i)
    expect(() => assertQueueEligible(prospect({ outreachStatus: 'queued' }), false, 0)).toThrow(/already active/i)
    expect(() => assertQueueEligible(prospect(), false, 0)).not.toThrow()
  })
})

describe('suppression, attempts, and server policies', () => {
  it.each(['unsubscribe', 'bounce', 'complaint', 'manual'] as const)('%s suppression blocks outreach', (reason) => {
    expect(addSuppression('HELLO@EXAMPLE.COM', reason)).toEqual({ normalizedEmail: 'hello@example.com', reason })
    expect(() => assertQueueEligible(prospect(), true, 0)).toThrow(/suppressed/i)
  })
  it('provides no automatic unsuppression transition', () => {
    expect(() => transitionOutreach('suppressed', 'not_contacted')).toThrow(/invalid outreach/i)
  })
  it('allows an initial attempt and one follow-up, then rejects a third', () => {
    expect(nextAttemptSequence(0)).toBe(1)
    expect(nextAttemptSequence(1)).toBe(2)
    expect(() => nextAttemptSequence(2)).toThrow(/maximum/i)
  })
  it('owns conservative future-send policy on the server boundary', () => {
    expect(MAX_OUTREACH_ATTEMPTS).toBe(2)
    expect(INITIAL_DAILY_SEND_LIMIT).toBe(10)
    expect(isSendingEnabled()).toBe(false)
    expect(isSendingEnabled({ ACQUISITION_SENDING_ENABLED: 'false' })).toBe(false)
    expect(isSendingEnabled({ ACQUISITION_SENDING_ENABLED: 'true' })).toBe(true)
  })
})
