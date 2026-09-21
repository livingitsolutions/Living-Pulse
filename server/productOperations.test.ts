import { describe, expect, it } from 'vitest'
import { createProductOperations, ProductOperationError, type IdempotencyRecord, type ProductOperationRepository, type ProductTransaction, type StoredPulse, requestFingerprint } from './productOperations.js'

function memoryRepository() {
  const state = { pulses: [] as StoredPulse[], responses: [] as Array<{ pulseId: string; optionId: string; followUpOptionId: string | null; followUpText: string | null; email: string | null }>, events: [] as Array<{ name: string }>, feedback: 0, ledger: new Map<string, IdempotencyRecord>(), failNextEvents: false }
  let sequence = Promise.resolve()
  const tx = (): ProductTransaction => ({
    async countCreatedPulses() { return state.events.filter((event) => event.name === 'pulse_created').length },
    async insertPulse(input) { const pulse = { ...input, id: `pulse-${state.pulses.length + 1}`, creatorKey: `creator-${state.pulses.length + 1}`, createdAt: new Date() }; state.pulses.push(pulse); return pulse },
    async findPulse(id) { return state.pulses.find((pulse) => pulse.id === id) ?? null },
    async findOwnedPulse(id, key) { return state.pulses.find((pulse) => pulse.id === id && pulse.creatorKey === key) ?? null },
    async insertEvents(events) { if (state.failNextEvents) { state.failNextEvents = false; throw new Error('injected failure') }; state.events.push(...events); return events.map((_, index) => ({ id: state.events.length - events.length + index + 1 })) },
    async insertResponse(input) { state.responses.push(input); return { id: state.responses.length } },
    async listResponses(pulseId) { return state.responses.filter((response) => response.pulseId === pulseId) },
    async updateStatus(id, status) { const pulse = state.pulses.find((item) => item.id === id); if (pulse) pulse.status = status },
    async insertFeedback() { state.feedback++; return { id: state.feedback } },
  })
  const repository: ProductOperationRepository = {
    findPulse: (id) => tx().findPulse(id), findOwnedPulse: (id, key) => tx().findOwnedPulse(id, key), transaction: (work) => work(tx()),
    runIdempotent(request, execute, replay) {
      const work = sequence.then(async () => {
        const ledgerKey = `${request.operationScope}:${request.idempotencyKeyHash}`
        const existing = state.ledger.get(ledgerKey)
        if (existing) {
          if (existing.requestFingerprint !== request.requestFingerprint) throw new ProductOperationError('Idempotency key conflicts with a different request.', 409)
          return { value: await replay(tx(), existing), replayed: true }
        }
        const snapshot = structuredClone({ pulses: state.pulses, responses: state.responses, events: state.events, feedback: state.feedback })
        state.ledger.set(ledgerKey, { requestFingerprint: request.requestFingerprint, status: 'in_progress', resourceType: null, resourceId: null })
        try {
          const result = await execute(tx())
          state.ledger.set(ledgerKey, { requestFingerprint: request.requestFingerprint, status: 'completed', resourceType: result.resourceType ?? null, resourceId: result.resourceId ?? null })
          return { value: result.result, replayed: false }
        } catch (error) {
          state.pulses = snapshot.pulses; state.responses = snapshot.responses; state.events = snapshot.events; state.feedback = snapshot.feedback; state.ledger.delete(ledgerKey)
          throw error
        }
      })
      sequence = work.then(() => undefined, () => undefined)
      return work
    },
  }
  return { state, operations: createProductOperations(repository) }
}

const pulseInput = { businessName: 'Bakery', idea: 'Late opening', question: 'Would you visit?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], allowUpdates: true, sessionId: 'session' }

describe('durable product-operation idempotency contract', () => {
  it('fingerprints canonical objects but preserves array order', () => {
    expect(requestFingerprint({ b: 2, a: 1 })).toBe(requestFingerprint({ a: 1, b: 2 }))
    expect(requestFingerprint([1, 2])).not.toBe(requestFingerprint([2, 1]))
  })

  it('replays concurrent Pulse creation without duplicate Pulse or telemetry', async () => {
    const fixture = memoryRepository()
    const [first, replay] = await Promise.all([fixture.operations.createPulse(pulseInput, 'opaque-key'), fixture.operations.createPulse(pulseInput, 'opaque-key')])
    expect(first.value.id).toBe(replay.value.id)
    expect(first.value.creatorKey).toBe(replay.value.creatorKey)
    expect(fixture.state.pulses).toHaveLength(1)
    expect(fixture.state.events).toHaveLength(2)
    expect(JSON.stringify([...fixture.state.ledger.keys()])).not.toContain('opaque-key')
  })

  it('fails closed when the same key describes another request', async () => {
    const fixture = memoryRepository()
    await fixture.operations.createPulse(pulseInput, 'same-key')
    await expect(fixture.operations.createPulse({ ...pulseInput, idea: 'Different' }, 'same-key')).rejects.toMatchObject({ status: 409 })
    expect(fixture.state.pulses).toHaveLength(1)
  })

  it('does not consume a key when validation fails', async () => {
    const fixture = memoryRepository()
    await expect(fixture.operations.createPulse({ ...pulseInput, options: [] }, 'retry-key')).rejects.toMatchObject({ status: 400 })
    await expect(fixture.operations.createPulse(pulseInput, 'retry-key')).resolves.toBeTruthy()
  })

  it('rolls back the claim and business writes when execution fails', async () => {
    const fixture = memoryRepository()
    fixture.state.failNextEvents = true
    await expect(fixture.operations.createPulse(pulseInput, 'rollback-key')).rejects.toThrow('injected failure')
    expect(fixture.state.pulses).toHaveLength(0)
    expect(fixture.state.ledger.size).toBe(0)
    await expect(fixture.operations.createPulse(pulseInput, 'rollback-key')).resolves.toBeTruthy()
    expect(fixture.state.pulses).toHaveLength(1)
  })

  it('replays responses without duplicate feedback, opt-in, or telemetry', async () => {
    const fixture = memoryRepository()
    const pulse = (await fixture.operations.createPulse({ ...pulseInput, followUp: { type: 'written_feedback', question: 'Why?' } }, 'pulse-key')).value
    const body = { optionId: 'yes', followUpText: 'Useful detail', email: 'PERSON@EXAMPLE.COM', sessionId: 'respondent' }
    await Promise.all([fixture.operations.submitResponse(pulse.id, body, 'response-key'), fixture.operations.submitResponse(pulse.id, body, 'response-key')])
    expect(fixture.state.responses).toHaveLength(1)
    expect(fixture.state.responses[0]).toMatchObject({ followUpText: 'Useful detail', email: 'person@example.com' })
    expect(fixture.state.events.filter((event) => event.name === 'response_completed')).toHaveLength(1)
    expect(fixture.state.events.filter((event) => event.name === 'update_opt_in')).toHaveLength(1)
    expect(JSON.stringify([...fixture.state.ledger.values()])).not.toContain('Useful detail')
  })

  it('keeps creator authorization independent while deduplicating feedback', async () => {
    const fixture = memoryRepository()
    const pulse = (await fixture.operations.createPulse(pulseInput, 'pulse')).value
    const feedback = { key: pulse.creatorKey, decision: 'A', useful: 'B', affectedPlan: 'C', useAgain: 'D', worthPaying: 'E' }
    await fixture.operations.submitCreatorFeedback(pulse.id, feedback, 'feedback-key')
    await fixture.operations.submitCreatorFeedback(pulse.id, feedback, 'feedback-key')
    expect(fixture.state.feedback).toBe(1)
    await expect(fixture.operations.submitCreatorFeedback(pulse.id, { ...feedback, key: 'wrong' }, 'another-key')).rejects.toMatchObject({ status: 403 })
  })
})
