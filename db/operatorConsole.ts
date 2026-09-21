import { INITIAL_DAILY_SEND_LIMIT, MAX_OUTREACH_ATTEMPTS, type SuppressionReason } from '../src/acquisitionFoundation.js'
import type { GrowthOverview } from '../src/growthTypes.js'
import { validMutationOrigin } from './operatorAuth.js'
import type { AcquisitionConsoleRepository } from './acquisitionConsole.js'
import { candidateToProspectInput, DiscoveryProviderUnavailableError, runDiscovery, type DiscoveryCandidate, type ProspectDiscoveryProvider } from '../src/prospectDiscovery.js'
import type { ProspectInput } from '../src/acquisitionFoundation.js'
import { normalizeEmail } from '../src/acquisitionFoundation.js'

type MutationServices = {
  qualifyProspect(id: string): Promise<unknown>
  rejectProspect(id: string, reason: string): Promise<unknown>
  suppressProspect(id: string, reason: SuppressionReason): Promise<unknown>
  queueProspect(id: string): Promise<unknown>
  createProspect(input: ProspectInput): Promise<unknown>
}

const suppressionReasons = ['manual', 'unsubscribe', 'bounce', 'complaint', 'invalid'] as const
const json = (body: unknown, status = 200) => Response.json(body, { status })
const safeFailure = (message = 'The request could not be completed.', status = 409) => json({ error: message }, status)

function logFailure(classification: 'discovery_provider_unavailable' | 'discovery_internal' | 'operator_request_rejected') {
  console.error('Growth operator request failed', { classification })
}

export function createOperatorConsoleHandler(dependencies: {
  authenticated(request: Request): Promise<boolean>
  repository: AcquisitionConsoleRepository
  services: MutationServices
  discoveryProvider: ProspectDiscoveryProvider
  prospectExistsByEmail(normalizedEmail: string): Promise<boolean>
}) {
  return async (request: Request) => {
    if (!await dependencies.authenticated(request)) return json({ error: 'Authentication required' }, 401)
    const parts = new URL(request.url).pathname.replace(/^\/api\/operator\/?/, '').split('/').filter(Boolean)
    if (request.method === 'POST' && !validMutationOrigin(request)) return json({ error: 'Request origin rejected' }, 403)

    try {
      if (request.method === 'POST' && parts.join('/') === 'prospects/discover') {
        try {
          const body = await request.json() as { criteria?: unknown }
          const discovered = await runDiscovery(dependencies.discoveryProvider, body.criteria)
          const candidates = await Promise.all(discovered.map(async (candidate) => ({ ...candidate, existingProspect: await dependencies.prospectExistsByEmail(normalizeEmail(candidate.publicEmailEvidence.email)) })))
          return json({ provider: dependencies.discoveryProvider.id, candidates })
        } catch (error) {
          const unavailable = error instanceof DiscoveryProviderUnavailableError
          logFailure(unavailable ? 'discovery_provider_unavailable' : 'discovery_internal')
          return safeFailure('Discovery could not be completed.', unavailable ? 503 : 409)
        }
      }
      if (request.method === 'POST' && parts.join('/') === 'prospects/import') {
        const body = await request.json() as { candidate?: DiscoveryCandidate }
        if (!body.candidate) return json({ error: 'A confirmed discovery candidate is required.' }, 400)
        const prospect = await dependencies.services.createProspect(candidateToProspectInput(body.candidate))
        return json({ prospect }, 201)
      }
      if (request.method === 'GET' && parts.join('/') === 'acquisition/overview') {
        const prospects = await dependencies.repository.listProspects()
        const overview: GrowthOverview = {
          total: prospects.length,
          pending: prospects.filter((item) => item.qualificationStatus === 'pending').length,
          qualified: prospects.filter((item) => item.qualificationStatus === 'qualified').length,
          queued: prospects.filter((item) => item.outreachStatus === 'queued').length,
          sent: prospects.filter((item) => item.outreachStatus === 'sent').length,
          replied: prospects.filter((item) => item.outreachStatus === 'replied').length,
          converted: prospects.filter((item) => item.outreachStatus === 'converted').length,
          suppressed: prospects.filter((item) => item.outreachStatus === 'suppressed').length,
          policy: { sendingEnabled: false, dailyLimit: INITIAL_DAILY_SEND_LIMIT, maximumAttempts: MAX_OUTREACH_ATTEMPTS },
        }
        return json(overview)
      }
      if (request.method === 'GET' && parts.length === 1 && parts[0] === 'prospects') return json(await dependencies.repository.listProspects())
      if (request.method === 'GET' && parts.join('/') === 'outreach') return json(await dependencies.repository.listAttempts())
      if (request.method === 'GET' && parts.join('/') === 'suppressions') return json(await dependencies.repository.listSuppressions())
      if (parts[0] === 'prospects' && parts[1]) {
        const id = parts[1]
        if (request.method === 'GET' && parts.length === 2) {
          const prospect = await dependencies.repository.findProspect(id)
          return prospect ? json(prospect) : json({ error: 'Prospect not found' }, 404)
        }
        if (request.method === 'POST' && parts.length === 3) {
          let body: Record<string, unknown> = {}
          try { body = await request.json() as Record<string, unknown> } catch { /* body is optional for qualify/queue */ }
          if (parts[2] === 'qualify') await dependencies.services.qualifyProspect(id)
          else if (parts[2] === 'reject') await dependencies.services.rejectProspect(id, typeof body.reason === 'string' ? body.reason : '')
          else if (parts[2] === 'suppress') {
            if (!suppressionReasons.includes(body.reason as SuppressionReason)) return json({ error: 'A valid suppression reason is required' }, 400)
            await dependencies.services.suppressProspect(id, body.reason as SuppressionReason)
          } else if (parts[2] === 'queue') await dependencies.services.queueProspect(id)
          else return json({ error: 'Not found' }, 404)
          return json({ ok: true })
        }
      }
      return json({ error: 'Not found' }, 404)
    } catch {
      logFailure('operator_request_rejected')
      return safeFailure()
    }
  }
}
