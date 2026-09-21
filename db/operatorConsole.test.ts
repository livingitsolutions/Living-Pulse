import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { GrowthProspectDetail, GrowthProspectSummary } from '../src/growthTypes'
import { createOperatorConsoleHandler } from './operatorConsole'
import type { AcquisitionConsoleRepository } from './acquisitionConsole'
import type { DiscoveryCandidate, ProspectDiscoveryProvider } from '../src/prospectDiscovery'

const ORIGIN = 'https://livingpulse.example'
const prospect: GrowthProspectSummary = { id: 'prospect-1', businessName: 'Public Coffee', industry: 'Hospitality', locationText: 'Bristol', qualificationStatus: 'pending', outreachStatus: 'not_contacted', attemptCount: 0, sourceType: 'business_website' }
const detail: GrowthProspectDetail = {
  ...prospect,
  websiteUrl: 'https://publiccoffee.example',
  publicContactEmail: 'hello@publiccoffee.example',
  sourceUrl: 'https://publiccoffee.example/contact',
  sourceObservedAt: '2026-09-21T10:00:00.000Z',
  evidenceNote: 'The contact page lists the observed email.',
  potentialUseCase: null,
  emailSourceUrl: 'https://publiccoffee.example/contact',
  personalizationContext: null,
  personalizationEvidence: null,
  rejectionReason: null,
  suppression: null,
  attempts: [],
  safety: { publicSourceEvidence: true, validPublicEmail: true, qualified: false, notSuppressed: true, attemptCapacity: true },
}

function setup(authenticated = true) {
  const repository = {
    listProspects: vi.fn(async () => [prospect]),
    findProspect: vi.fn(async () => detail),
    listAttempts: vi.fn(async () => []),
    listSuppressions: vi.fn(async () => []),
  } as unknown as AcquisitionConsoleRepository
  const services = {
    qualifyProspect: vi.fn(async () => prospect),
    rejectProspect: vi.fn(async (_id: string, reason: string) => { if (!reason.trim()) throw new Error('Invalid qualification transition or rejection reason.'); return prospect }),
    suppressProspect: vi.fn(async () => prospect),
    queueProspect: vi.fn(async () => ({ prospect, attempt: { id: 'attempt-1' } })),
    createProspect: vi.fn(async () => prospect),
  }
  const discoveryCandidate: DiscoveryCandidate = { businessName: 'Public Coffee', industry: 'Hospitality', locationText: 'Bristol', websiteUrl: 'https://publiccoffee.example', sourceType: 'business_website', sourceUrl: 'https://publiccoffee.example/contact', sourceObservedAt: '2026-09-21T10:00:00Z', evidenceNote: 'The contact page identifies the business.', potentialUseCase: 'Could test customer interest in a menu idea.', personalizationContext: null, personalizationEvidence: null, publicEmailEvidence: { email: 'hello@publiccoffee.example', sourceUrl: 'https://publiccoffee.example/contact', observedText: 'Email hello@publiccoffee.example' } }
  const discoveryProvider: ProspectDiscoveryProvider = { id: 'test_public_search', discover: vi.fn(async () => [discoveryCandidate]) }
  return { handler: createOperatorConsoleHandler({ authenticated: async () => authenticated, repository, services, discoveryProvider, prospectExistsByEmail: async () => false }), repository, services, discoveryProvider }
}

const request = (path: string, init: RequestInit = {}) => new Request(`${ORIGIN}/api/operator/${path}`, init)
const mutation = (path: string, body: object = {}, origin = ORIGIN) => request(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('operator console authentication and reads', () => {
  it.each(['acquisition/overview', 'prospects', 'prospects/prospect-1', 'outreach', 'suppressions'])('rejects unauthenticated %s reads', async (path) => {
    const { handler, repository } = setup(false)
    expect((await handler(request(path))).status).toBe(401)
    expect(repository.listProspects).not.toHaveBeenCalled()
  })

  it.each(['prospects/prospect-1/qualify', 'prospects/prospect-1/reject', 'prospects/prospect-1/suppress', 'prospects/prospect-1/queue'])('rejects unauthenticated %s mutations', async (path) => {
    expect((await setup(false).handler(mutation(path, { reason: 'manual' }))).status).toBe(401)
  })

  it.each(['prospects/discover', 'prospects/import'])('rejects unauthenticated discovery mutation %s', async (path) => {
    expect((await setup(false).handler(mutation(path, {}))).status).toBe(401)
  })

  it('returns correct overview counts and fixed disabled-delivery policy', async () => {
    const state = setup()
    const overviewRows: GrowthProspectSummary[] = [
      prospect,
      { ...prospect, id: '2', qualificationStatus: 'qualified', outreachStatus: 'queued' },
      { ...prospect, id: '3', qualificationStatus: 'qualified', outreachStatus: 'sent' },
      { ...prospect, id: '4', qualificationStatus: 'qualified', outreachStatus: 'replied' },
      { ...prospect, id: '5', qualificationStatus: 'qualified', outreachStatus: 'converted' },
      { ...prospect, id: '6', qualificationStatus: 'rejected', outreachStatus: 'suppressed' },
    ]
    state.repository.listProspects = vi.fn(async () => overviewRows)
    const response = await state.handler(request('acquisition/overview'))
    expect(await response.json()).toEqual({ total: 6, pending: 1, qualified: 4, queued: 1, sent: 1, replied: 1, converted: 1, suppressed: 1, policy: { sendingEnabled: false, dailyLimit: 10, maximumAttempts: 2 } })
  })

  it('returns required detail fields without forbidden operator or respondent data', async () => {
    const response = await setup().handler(request('prospects/prospect-1'))
    const body = await response.json() as Record<string, unknown>
    expect(body).toMatchObject({ businessName: 'Public Coffee', publicContactEmail: 'hello@publiccoffee.example', sourceUrl: expect.any(String), safety: expect.any(Object), attempts: [] })
    expect(JSON.stringify(body)).not.toMatch(/creatorKey|session|tokenHash|respondent|writtenFeedback|RESEND_API_KEY/)
  })
})

describe('operator console mutations', () => {
  it('discovers ephemerally with validated criteria and imports only after an explicit request', async () => {
    const state = setup()
    const discovery = await state.handler(mutation('prospects/discover', { criteria: { category: 'Cafe', location: 'Bristol', maxResults: 1 } }))
    expect(discovery.status).toBe(200)
    expect(state.services.createProspect).not.toHaveBeenCalled()
    const body = await discovery.json() as { candidates: DiscoveryCandidate[] }
    expect((await state.handler(mutation('prospects/import', { candidate: body.candidates[0] }))).status).toBe(201)
    expect(state.services.createProspect).toHaveBeenCalledOnce()
    expect(state.services.qualifyProspect).not.toHaveBeenCalled()
    expect(state.services.queueProspect).not.toHaveBeenCalled()
  })

  it('rejects invalid criteria before invoking discovery', async () => {
    const state = setup()
    expect((await state.handler(mutation('prospects/discover', { criteria: { category: '', location: 'Bristol', maxResults: 11 } }))).status).toBe(409)
    expect(state.discoveryProvider.discover).not.toHaveBeenCalled()
  })

  it('returns a safe service-unavailable response when live discovery is not configured', async () => {
    const state = setup()
    state.discoveryProvider.discover = vi.fn(async () => { throw new (await import('../src/prospectDiscovery')).DiscoveryProviderUnavailableError() })
    const response = await state.handler(mutation('prospects/discover', { criteria: { category: 'Cafe', location: 'Bristol', maxResults: 1 } }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/not configured/i) })
    expect(state.services.createProspect).not.toHaveBeenCalled()
  })
  it('delegates qualification and required-reason rejection to application services', async () => {
    const state = setup()
    expect((await state.handler(mutation('prospects/prospect-1/qualify'))).status).toBe(200)
    expect(state.services.qualifyProspect).toHaveBeenCalledWith('prospect-1')
    expect((await state.handler(mutation('prospects/prospect-1/reject', { reason: '' }))).status).toBe(409)
    expect(state.services.rejectProspect).toHaveBeenCalledWith('prospect-1', '')
  })

  it('delegates queue and suppression without delivery behavior', async () => {
    const state = setup()
    expect((await state.handler(mutation('prospects/prospect-1/queue'))).status).toBe(200)
    expect(state.services.queueProspect).toHaveBeenCalledWith('prospect-1')
    expect((await state.handler(mutation('prospects/prospect-1/suppress', { reason: 'manual' }))).status).toBe(200)
    expect(state.services.suppressProspect).toHaveBeenCalledWith('prospect-1', 'manual')
  })

  it('rejects invalid mutation origins before calling a service', async () => {
    const state = setup()
    expect((await state.handler(mutation('prospects/prospect-1/qualify', {}, 'https://attacker.example'))).status).toBe(403)
    expect(state.services.qualifyProspect).not.toHaveBeenCalled()
  })

  it('applies CSRF protection to discovery preview and import', async () => {
    const state = setup()
    expect((await state.handler(mutation('prospects/discover', {}, 'https://attacker.example'))).status).toBe(403)
    expect((await state.handler(mutation('prospects/import', {}, 'https://attacker.example'))).status).toBe(403)
    expect(state.services.createProspect).not.toHaveBeenCalled()
  })

  it('has no unsuppression route', async () => {
    expect((await setup().handler(mutation('prospects/prospect-1/unsuppress'))).status).toBe(404)
  })
})

describe('growth console isolation', () => {
  it('uses password login and never persists credentials in browser storage or URLs', async () => {
    const ui = await readFile('src/GrowthConsole.tsx', 'utf8')
    expect(ui).toMatch(/type="password"/)
    expect(ui).toMatch(/setCredential\(''\)/)
    expect(ui).not.toMatch(/localStorage|sessionStorage|searchParams.*credential/)
  })

  it('contains no delivery, discovery, scheduled, or secret integration', async () => {
    const files = await Promise.all(['db/operatorConsole.ts', 'db/acquisitionConsole.ts', 'src/GrowthConsole.tsx', 'netlify/functions/api.mts'].map((file) => readFile(file, 'utf8')))
    expect(files.join('\n')).not.toMatch(/RESEND_API_KEY|\bresend\b|sendEmail|schedule\s*:|webhook|google maps|scrape|crawl/i)
  })

  it('keeps acquisition behind operator routes and the public API capability check unchanged', async () => {
    const api = await readFile('netlify/functions/api.mts', 'utf8')
    expect(api).toMatch(/getCreatorResults\(id, request\.headers\.get\('x-creator-key'\)/)
    expect(api).not.toMatch(/operatorConsole|acquisitionConsole|hasOperatorSession/)
    const growthApi = await readFile('netlify/growth-functions/api.mts', 'utf8')
    expect(growthApi).toMatch(/hasOperatorSession/)
    expect(growthApi).toMatch(/createOperatorConsoleHandler/)
  })
})
