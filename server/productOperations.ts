import { createHash } from 'node:crypto'
import { parseAttribution, type AcquisitionAttribution } from '../src/acquisition.js'
import type { FollowUp, PulseOption } from '../src/types.js'
import { collectWrittenFeedback, hasWrittenFeedbackQuestion, isWrittenFollowUp, writtenFeedbackValue } from '../src/validation.js'

export const PRODUCT_STATUSES = ['Draft', 'Testing', 'Planned', 'Coming Soon', 'Launched', 'Archived'] as const
export const PRODUCT_EVENT_NAMES = ['landing_viewed', 'create_started', 'pulse_created', 'pulse_published', 'pulse_link_copied', 'qr_downloaded', 'public_pulse_viewed', 'response_started', 'response_completed', 'update_opt_in', 'results_viewed', 'second_pulse_created', 'powered_by_clicked'] as const
export type ProductOperationScope = 'create_pulse' | 'submit_response' | 'submit_creator_feedback' | 'record_telemetry'

export type StoredPulse = {
  id: string
  creatorKey: string
  businessName: string
  idea: string
  question: string
  options: PulseOption[]
  followUp: FollowUp | null
  allowUpdates: boolean
  status: string
  createdAt: Date
}
export type StoredResponse = { optionId: string; followUpOptionId: string | null; followUpText: string | null; email: string | null }
export type ProductEventInput = { name: string; pulseId?: string | null; sessionId?: string | null; metadata?: Record<string, string | number | boolean> | AcquisitionAttribution | null }
export type IdempotencyRecord = { requestFingerprint: string; status: 'in_progress' | 'completed'; resourceType: string | null; resourceId: string | null }
export type IdempotentResult<T> = { result: T; resourceType?: string; resourceId?: string }

export interface ProductTransaction {
  countCreatedPulses(sessionId: string): Promise<number>
  insertPulse(input: Omit<StoredPulse, 'id' | 'creatorKey' | 'createdAt'>): Promise<StoredPulse>
  findPulse(id: string): Promise<StoredPulse | null>
  findOwnedPulse(id: string, creatorKey: string): Promise<StoredPulse | null>
  insertEvents(events: ProductEventInput[]): Promise<Array<{ id: number }>>
  insertResponse(input: { pulseId: string } & StoredResponse): Promise<{ id: number }>
  listResponses(pulseId: string): Promise<StoredResponse[]>
  updateStatus(id: string, status: string): Promise<void>
  insertFeedback(input: { pulseId: string; decision: string; useful: string; affectedPlan: string; useAgain: string; worthPaying: string }): Promise<{ id: number }>
}

export interface ProductOperationRepository {
  findPulse(id: string): Promise<StoredPulse | null>
  findOwnedPulse(id: string, creatorKey: string): Promise<StoredPulse | null>
  runIdempotent<T>(
    request: { operationScope: ProductOperationScope; idempotencyKeyHash: string; requestFingerprint: string },
    execute: (tx: ProductTransaction) => Promise<IdempotentResult<T>>,
    replay: (tx: ProductTransaction, record: IdempotencyRecord) => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }>
  transaction<T>(operation: (tx: ProductTransaction) => Promise<T>): Promise<T>
}

export class ProductOperationError extends Error {
  constructor(message: string, public readonly status: number) { super(message) }
}

const clean = (value: unknown, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const hashIdempotencyKey = (key: string) => hash(key)
export const requestFingerprint = (value: unknown) => hash(canonical(value))

function idempotency(key: string, operationScope: ProductOperationScope, logicalRequest: unknown) {
  if (!key) throw new ProductOperationError('An idempotency key is required.', 400)
  return { operationScope, idempotencyKeyHash: hashIdempotencyKey(key), requestFingerprint: requestFingerprint(logicalRequest) }
}

function normalizePulse(body: Record<string, unknown>) {
  const options = Array.isArray(body.options) ? body.options.map((option) => ({ id: clean((option as Record<string, unknown>).id, 80), label: clean((option as Record<string, unknown>).label, 120) })).filter((option) => option.id && option.label) : []
  const businessName = clean(body.businessName, 120)
  const idea = clean(body.idea, 160)
  const question = clean(body.question, 300)
  if (!businessName || !idea || !question || options.length < 2) throw new ProductOperationError('Business name, idea, question, and at least two options are required.', 400)
  let followUp: FollowUp | null = null
  if (body.followUp && typeof body.followUp === 'object') {
    const raw = body.followUp as Record<string, unknown>
    const followQuestion = clean(raw.question, 300)
    if (raw.type === 'written_feedback') {
      if (!hasWrittenFeedbackQuestion(followQuestion)) throw new ProductOperationError('Written feedback needs a feedback question.', 400)
      followUp = { type: 'written_feedback', question: followQuestion }
    } else {
      const followOptions = Array.isArray(raw.options) ? raw.options.map((option) => ({ id: clean((option as Record<string, unknown>).id, 80), label: clean((option as Record<string, unknown>).label, 120) })).filter((option) => option.id && option.label) : []
      if (!followQuestion || followOptions.length < 2) throw new ProductOperationError('A follow-up needs a question and at least two options.', 400)
      followUp = { type: 'multiple_choice', question: followQuestion, options: followOptions }
    }
  }
  return { businessName, idea, question, options, followUp, allowUpdates: body.allowUpdates === true, status: 'Testing' }
}

function publicPulse(pulse: StoredPulse) {
  return { id: pulse.id, businessName: pulse.businessName, idea: pulse.idea, question: pulse.question, options: pulse.options, followUp: pulse.followUp, allowUpdates: pulse.allowUpdates, createdAt: pulse.createdAt }
}

function requireResource(record: IdempotencyRecord, type: string) {
  if (record.status !== 'completed' || record.resourceType !== type || !record.resourceId) throw new ProductOperationError('Operation is still in progress.', 409)
  return record.resourceId
}

export function createProductOperations(repository: ProductOperationRepository) {
  return {
    async recordTelemetry(body: Record<string, unknown>, key: string) {
      if (!PRODUCT_EVENT_NAMES.includes(String(body.name) as typeof PRODUCT_EVENT_NAMES[number])) throw new ProductOperationError('Unknown event', 400)
      const event: ProductEventInput = {
        name: String(body.name),
        pulseId: clean(body.pulseId) || null,
        sessionId: clean(body.sessionId, 100) || null,
        metadata: body.name === 'powered_by_clicked' ? parseAttribution({ source: (body.metadata as Record<string, unknown> | null)?.source, sourcePulseId: body.pulseId }) : typeof body.metadata === 'object' ? body.metadata as Record<string, string | number | boolean> : null,
      }
      return repository.runIdempotent(idempotency(key, 'record_telemetry', event), async (tx) => {
        const [saved] = await tx.insertEvents([event])
        return { result: { ok: true as const }, resourceType: 'event', resourceId: String(saved.id) }
      }, async (_tx, record) => { requireResource(record, 'event'); return { ok: true as const } })
    },

    async createPulse(body: Record<string, unknown>, key: string) {
      const input = normalizePulse(body)
      const sessionId = clean(body.sessionId, 100)
      const acquisition = parseAttribution(body.acquisition)
      const logical = { ...input, sessionId, acquisition }
      return repository.runIdempotent(idempotency(key, 'create_pulse', logical), async (tx) => {
        const prior = sessionId ? await tx.countCreatedPulses(sessionId) : 0
        const pulse = await tx.insertPulse(input)
        const base = { pulseId: pulse.id, sessionId, metadata: acquisition }
        await tx.insertEvents([{ name: 'pulse_created', ...base }, { name: 'pulse_published', ...base }, ...(prior > 0 ? [{ name: 'second_pulse_created', ...base }] : [])])
        return { result: pulse, resourceType: 'pulse', resourceId: pulse.id }
      }, async (tx, record) => {
        const pulse = await tx.findPulse(requireResource(record, 'pulse'))
        if (!pulse) throw new ProductOperationError('The request could not be completed.', 500)
        return pulse
      })
    },

    async getPublicPulse(id: string) {
      const pulse = await repository.findPulse(id)
      if (!pulse) throw new ProductOperationError('Pulse not found', 404)
      return publicPulse(pulse)
    },

    async submitResponse(id: string, body: Record<string, unknown>, key: string) {
      const initialPulse = await repository.findPulse(id)
      if (!initialPulse) throw new ProductOperationError('Pulse not found', 404)
      const optionId = clean(body.optionId, 80)
      const followUpOptionId = clean(body.followUpOptionId, 80) || null
      const written = writtenFeedbackValue(body.followUpText)
      if (!written.valid) throw new ProductOperationError('Written feedback must be 1000 characters or fewer.', 400)
      const email = initialPulse.allowUpdates ? clean(body.email, 320).toLowerCase() || null : null
      const sessionId = clean(body.sessionId, 100)
      const normalized = { pulseId: id, optionId, followUpOptionId, followUpText: written.value, email, sessionId }
      const validate = (pulse: StoredPulse) => {
        if (!pulse.options.some((option) => option.id === optionId)) throw new ProductOperationError('Choose a valid response.', 400)
        if (pulse.followUp && !isWrittenFollowUp(pulse.followUp) && !pulse.followUp.options.some((option) => option.id === followUpOptionId)) throw new ProductOperationError('Choose a follow-up response.', 400)
        if (isWrittenFollowUp(pulse.followUp) && followUpOptionId) throw new ProductOperationError('Written feedback does not accept response options.', 400)
        if (!isWrittenFollowUp(pulse.followUp) && written.value) throw new ProductOperationError('Written feedback is not configured for this Pulse.', 400)
        if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new ProductOperationError('Enter a valid email address.', 400)
      }
      validate(initialPulse)
      return repository.runIdempotent(idempotency(key, 'submit_response', normalized), async (tx) => {
        const pulse = await tx.findPulse(id)
        if (!pulse) throw new ProductOperationError('Pulse not found', 404)
        validate(pulse)
        const saved = await tx.insertResponse({ pulseId: id, optionId, followUpOptionId, followUpText: written.value, email })
        await tx.insertEvents([{ name: 'response_completed', pulseId: id, sessionId }, ...(email ? [{ name: 'update_opt_in', pulseId: id, sessionId }] : [])])
        return { result: { ok: true as const }, resourceType: 'response', resourceId: String(saved.id) }
      }, async (_tx, record) => { requireResource(record, 'response'); return { ok: true as const } })
    },

    async getCreatorResults(id: string, creatorKey: string) {
      const pulse = await repository.findOwnedPulse(id, creatorKey)
      if (!pulse) throw new ProductOperationError('Results access denied', 403)
      return repository.transaction(async (tx) => {
        const rows = await tx.listResponses(id)
        const total = rows.length
        const aggregate = (options: PulseOption[], field: 'optionId' | 'followUpOptionId') => options.map((option) => { const optionCount = rows.filter((row) => row[field] === option.id).length; return { ...option, count: optionCount, percentage: total ? Math.round(optionCount / total * 100) : 0 } })
        const { creatorKey: _creatorKey, ...safePulse } = pulse
        void _creatorKey
        return { pulse: safePulse, total, options: aggregate(pulse.options, 'optionId'), followUp: pulse.followUp && !isWrittenFollowUp(pulse.followUp) ? aggregate(pulse.followUp.options, 'followUpOptionId') : [], writtenFeedback: collectWrittenFeedback(rows), updateOptIns: rows.filter((row) => row.email).length }
      })
    },

    async updateLifecycle(id: string, body: Record<string, unknown>) {
      const status = clean(body.status, 30)
      const creatorKey = clean(body.key, 80)
      if (!PRODUCT_STATUSES.includes(status as typeof PRODUCT_STATUSES[number]) || !await repository.findOwnedPulse(id, creatorKey)) throw new ProductOperationError('Invalid status or access denied', 403)
      await repository.transaction((tx) => tx.updateStatus(id, status))
      return { status }
    },

    async submitCreatorFeedback(id: string, body: Record<string, unknown>, key: string) {
      const creatorKey = clean(body.key, 80)
      if (!await repository.findOwnedPulse(id, creatorKey)) throw new ProductOperationError('Access denied', 403)
      const values = { decision: clean(body.decision, 1000), useful: clean(body.useful, 1000), affectedPlan: clean(body.affectedPlan, 1000), useAgain: clean(body.useAgain, 1000), worthPaying: clean(body.worthPaying, 1000) }
      if (Object.values(values).some((value) => !value)) throw new ProductOperationError('Please answer every feedback question.', 400)
      return repository.runIdempotent(idempotency(key, 'submit_creator_feedback', { pulseId: id, ...values }), async (tx) => {
        if (!await tx.findOwnedPulse(id, creatorKey)) throw new ProductOperationError('Access denied', 403)
        const saved = await tx.insertFeedback({ pulseId: id, ...values })
        return { result: { ok: true as const }, resourceType: 'feedback', resourceId: String(saved.id) }
      }, async (tx, record) => {
        if (!await tx.findOwnedPulse(id, creatorKey)) throw new ProductOperationError('Access denied', 403)
        requireResource(record, 'feedback')
        return { ok: true as const }
      })
    },
  }
}
