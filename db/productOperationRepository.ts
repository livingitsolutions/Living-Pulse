import { and, count, eq } from 'drizzle-orm'
import { db } from './index.js'
import { events, feedback, productOperationIdempotency, pulses, responses } from './schema.js'
import { ProductOperationError, type IdempotencyRecord, type ProductOperationRepository, type ProductTransaction } from '../server/productOperations.js'

type Database = typeof db

function adapter(database: Database): ProductTransaction {
  return {
    async countCreatedPulses(sessionId) {
      const [row] = await database.select({ value: count() }).from(events).where(and(eq(events.sessionId, sessionId), eq(events.name, 'pulse_created')))
      return row.value
    },
    async insertPulse(input) { const [row] = await database.insert(pulses).values(input).returning(); return row },
    async findPulse(id) { const [row] = await database.select().from(pulses).where(eq(pulses.id, id)).limit(1); return row ?? null },
    async findOwnedPulse(id, creatorKey) { const [row] = await database.select().from(pulses).where(and(eq(pulses.id, id), eq(pulses.creatorKey, creatorKey))).limit(1); return row ?? null },
    async insertEvents(input) { return database.insert(events).values(input).returning({ id: events.id }) },
    async insertResponse(input) { const [row] = await database.insert(responses).values(input).returning({ id: responses.id }); return row },
    async listResponses(pulseId) { return database.select().from(responses).where(eq(responses.pulseId, pulseId)) },
    async updateStatus(id, status) { await database.update(pulses).set({ status }).where(eq(pulses.id, id)) },
    async insertFeedback(input) { const [row] = await database.insert(feedback).values(input).returning({ id: feedback.id }); return row },
  }
}

export const productOperationRepository: ProductOperationRepository = {
  async findPulse(id) { return adapter(db).findPulse(id) },
  async findOwnedPulse(id, creatorKey) { return adapter(db).findOwnedPulse(id, creatorKey) },
  async transaction(operation) { return db.transaction((transaction) => operation(adapter(transaction as unknown as Database))) },
  async runIdempotent(request, execute, replay) {
    return db.transaction(async (transaction) => {
      const database = transaction as unknown as Database
      const tx = adapter(database)
      const [claim] = await database.insert(productOperationIdempotency).values(request).onConflictDoNothing().returning()
      if (!claim) {
        const [existing] = await database.select().from(productOperationIdempotency).where(and(eq(productOperationIdempotency.operationScope, request.operationScope), eq(productOperationIdempotency.idempotencyKeyHash, request.idempotencyKeyHash))).limit(1)
        if (!existing || existing.requestFingerprint !== request.requestFingerprint) throw new ProductOperationError('Idempotency key conflicts with a different request.', 409)
        const record: IdempotencyRecord = { requestFingerprint: existing.requestFingerprint, status: existing.status as IdempotencyRecord['status'], resourceType: existing.resourceType, resourceId: existing.resourceId }
        if (record.status !== 'completed') throw new ProductOperationError('Operation is still in progress.', 409)
        return { value: await replay(tx, record), replayed: true }
      }
      const completed = await execute(tx)
      await database.update(productOperationIdempotency).set({ status: 'completed', resourceType: completed.resourceType ?? null, resourceId: completed.resourceId ?? null, completedAt: new Date(), updatedAt: new Date() }).where(eq(productOperationIdempotency.id, claim.id))
      return { value: completed.result, replayed: false }
    })
  },
}
