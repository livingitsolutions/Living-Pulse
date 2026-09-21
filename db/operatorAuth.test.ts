import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createOperatorAuthHandler, hashOpaqueValue, LOGIN_WINDOW_MS, MAX_LOGIN_FAILURES, OPERATOR_COOKIE_NAME, SESSION_DURATION_MS, type OperatorStore } from './operatorAuth.js'

const ORIGIN = 'https://livingpulse.example'
const SECRET = 'configured-test-credential'

type Session = { tokenHash: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null }

function fixture(options: { secret?: string; now?: Date; token?: string } = {}) {
  let current = options.now || new Date('2026-09-21T12:00:00Z')
  const sessions: Session[] = []
  const attempts: Array<{ clientHash: string; attemptedAt: Date }> = []
  const store: OperatorStore = {
    async createSession(session) { sessions.push(session) },
    async findActiveSession(tokenHash, now) {
      return sessions.some((session) => session.tokenHash === tokenHash && session.expiresAt > now && session.revokedAt === null)
    },
    async revokeSession(tokenHash, now) {
      const session = sessions.find((candidate) => candidate.tokenHash === tokenHash && candidate.revokedAt === null)
      if (session) session.revokedAt = now
    },
    async countRecentFailures(clientHash, since) {
      return attempts.filter((attempt) => attempt.clientHash === clientHash && attempt.attemptedAt > since).length
    },
    async recordFailure(clientHash, attemptedAt) { attempts.push({ clientHash, attemptedAt }) },
    async clearFailures(clientHash) {
      for (let index = attempts.length - 1; index >= 0; index--) if (attempts[index].clientHash === clientHash) attempts.splice(index, 1)
    },
  }
  const handler = createOperatorAuthHandler({
    store,
    secret: () => options.secret,
    now: () => current,
    randomToken: () => options.token || 'opaque-random-session-token',
  })
  return { handler, sessions, attempts, setNow: (value: Date) => { current = value } }
}

const request = (path: string, init: RequestInit = {}) => new Request(`${ORIGIN}/api/operator/${path}`, init)
const loginRequest = (credential: unknown, origin = ORIGIN) => request('login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify({ credential }),
})
const authenticatedRequest = (path: string, token: string, method = 'GET') => request(path, {
  method,
  headers: { Cookie: `${OPERATOR_COOKIE_NAME}=${token}`, ...(method === 'POST' ? { Origin: ORIGIN } : {}) },
})

describe('operator login', () => {
  it('fails closed without configuration and has no fallback credential', async () => {
    const { handler, sessions } = fixture()
    expect((await handler(loginRequest(SECRET), '192.0.2.1')).status).toBe(401)
    expect(sessions).toHaveLength(0)
  })

  it.each([['incorrect', 'wrong'], ['empty', ''], ['whitespace-only', '   ']])('rejects %s credentials generically', async (_label, credential) => {
    const { handler } = fixture({ secret: SECRET })
    const response = await handler(loginRequest(credential), '192.0.2.1')
    const text = await response.text()
    expect(response.status).toBe(401)
    expect(JSON.parse(text)).toEqual({ authenticated: false })
    if (credential) expect(text).not.toContain(String(credential))
  })

  it('rejects malformed JSON with the same generic response', async () => {
    const { handler } = fixture({ secret: SECRET })
    const response = await handler(request('login', { method: 'POST', headers: { Origin: ORIGIN }, body: '{' }), '192.0.2.1')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ authenticated: false })
  })

  it('creates a twelve-hour hashed session and secure opaque cookie', async () => {
    const token = 'raw-opaque-session-token'
    const { handler, sessions } = fixture({ secret: SECRET, token })
    const response = await handler(loginRequest(SECRET), '192.0.2.1')
    const cookie = response.headers.get('set-cookie') || ''
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authenticated: true })
    expect(sessions).toEqual([expect.objectContaining({ tokenHash: hashOpaqueValue(token), revokedAt: null })])
    expect(sessions[0].tokenHash).not.toBe(token)
    expect(sessions[0].expiresAt.getTime() - sessions[0].createdAt.getTime()).toBe(SESSION_DURATION_MS)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Path=/api/operator')
    expect(cookie).toContain(`${OPERATOR_COOKIE_NAME}=${token}`)
    expect(cookie).not.toContain(SECRET)
    expect(cookie).not.toContain(hashOpaqueValue(token))
  })
})

describe('operator session lifecycle', () => {
  it('accepts valid sessions and rejects unknown, expired, and revoked sessions', async () => {
    const token = 'session-token'
    const state = fixture({ secret: SECRET, token })
    await state.handler(loginRequest(SECRET), '192.0.2.1')
    expect((await state.handler(authenticatedRequest('protected-check', token), '192.0.2.1')).status).toBe(200)
    expect((await state.handler(authenticatedRequest('protected-check', 'unknown'), '192.0.2.1')).status).toBe(401)
    state.setNow(new Date('2026-09-22T00:00:01Z'))
    expect((await state.handler(authenticatedRequest('protected-check', token), '192.0.2.1')).status).toBe(401)
    state.setNow(new Date('2026-09-21T12:01:00Z'))
    state.sessions[0].revokedAt = new Date()
    expect((await state.handler(authenticatedRequest('protected-check', token), '192.0.2.1')).status).toBe(401)
  })

  it('reports minimal session state', async () => {
    const state = fixture({ secret: SECRET, token: 'session-token' })
    expect(await (await state.handler(request('session'), '192.0.2.1')).json()).toEqual({ authenticated: false })
    await state.handler(loginRequest(SECRET), '192.0.2.1')
    expect(await (await state.handler(authenticatedRequest('session', 'session-token'), '192.0.2.1')).json()).toEqual({ authenticated: true })
  })

  it('revokes and expires the cookie, and repeated logout is safe', async () => {
    const token = 'session-token'
    const state = fixture({ secret: SECRET, token })
    await state.handler(loginRequest(SECRET), '192.0.2.1')
    const first = await state.handler(authenticatedRequest('logout', token, 'POST'), '192.0.2.1')
    const second = await state.handler(authenticatedRequest('logout', token, 'POST'), '192.0.2.1')
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(state.sessions[0].revokedAt).toBeInstanceOf(Date)
    expect(first.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

describe('operator request protections', () => {
  it('accepts same-origin mutations and rejects cross-origin mutations', async () => {
    const { handler } = fixture({ secret: SECRET })
    expect((await handler(loginRequest(SECRET), '192.0.2.1')).status).toBe(200)
    expect((await handler(loginRequest(SECRET, 'https://attacker.example'), '192.0.2.1')).status).toBe(403)
  })

  it('database-limits repeated failures without storing credential data', async () => {
    const state = fixture({ secret: SECRET })
    for (let count = 0; count < MAX_LOGIN_FAILURES; count++) {
      expect((await state.handler(loginRequest('wrong'), '192.0.2.1')).status).toBe(401)
    }
    expect((await state.handler(loginRequest('wrong'), '192.0.2.1')).status).toBe(429)
    expect(JSON.stringify(state.attempts)).not.toContain('wrong')
    state.setNow(new Date(Date.parse('2026-09-21T12:00:00Z') + LOGIN_WINDOW_MS + 1))
    expect((await state.handler(loginRequest(SECRET), '192.0.2.1')).status).toBe(200)
    expect(state.attempts).toHaveLength(0)
  })

  it('keeps creator capabilities and operator sessions in separate domains', async () => {
    const state = fixture({ secret: SECRET, token: 'operator-token' })
    expect((await state.handler(request('protected-check', { headers: { 'x-creator-key': 'creator-capability' } }), '192.0.2.1')).status).toBe(401)
    const api = await readFile('netlify/functions/api.mts', 'utf8')
    expect(api).toMatch(/getCreatorResults\(id, request\.headers\.get\('x-creator-key'\)/)
    expect(api).not.toMatch(/owned\([^)]*operatorAuth/)
  })

  it('exposes no acquisition data or delivery integration', async () => {
    const files = await Promise.all(['operatorAuth.ts', 'operatorStore.ts'].map((file) => readFile(new URL(file, import.meta.url), 'utf8')))
    expect(files.join('\n')).not.toMatch(/acquisitionProspects|RESEND_API_KEY|\bresend\b|publicContactEmail|suppression/i)
  })
})
