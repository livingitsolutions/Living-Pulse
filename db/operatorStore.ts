import { and, count, eq, gt, isNull } from 'drizzle-orm'
import type { OperatorStore } from './operatorAuth.js'
import { db } from './index.js'
import { operatorLoginAttempts, operatorSessions } from './schema.js'

export const operatorStore: OperatorStore = {
  async createSession(session) {
    await db.insert(operatorSessions).values(session)
  },
  async findActiveSession(tokenHash, now) {
    const [row] = await db.select({ tokenHash: operatorSessions.tokenHash })
      .from(operatorSessions)
      .where(and(eq(operatorSessions.tokenHash, tokenHash), isNull(operatorSessions.revokedAt), gt(operatorSessions.expiresAt, now)))
      .limit(1)
    return Boolean(row)
  },
  async revokeSession(tokenHash, now) {
    await db.update(operatorSessions).set({ revokedAt: now })
      .where(and(eq(operatorSessions.tokenHash, tokenHash), isNull(operatorSessions.revokedAt)))
  },
  async countRecentFailures(clientHash, since) {
    const [row] = await db.select({ value: count() }).from(operatorLoginAttempts)
      .where(and(eq(operatorLoginAttempts.clientHash, clientHash), gt(operatorLoginAttempts.attemptedAt, since)))
    return row.value
  },
  async recordFailure(clientHash, attemptedAt) {
    await db.insert(operatorLoginAttempts).values({ clientHash, attemptedAt })
  },
  async clearFailures(clientHash) {
    await db.delete(operatorLoginAttempts).where(eq(operatorLoginAttempts.clientHash, clientHash))
  },
}
