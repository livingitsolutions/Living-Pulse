import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const OPERATOR_COOKIE_NAME = 'living_pulse_operator'
export const SESSION_DURATION_MS = 12 * 60 * 60 * 1000
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
export const MAX_LOGIN_FAILURES = 5

type SessionRecord = { tokenHash: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null }

export interface OperatorStore {
  createSession(session: SessionRecord): Promise<void>
  findActiveSession(tokenHash: string, now: Date): Promise<boolean>
  revokeSession(tokenHash: string, now: Date): Promise<void>
  countRecentFailures(clientHash: string, since: Date): Promise<number>
  recordFailure(clientHash: string, attemptedAt: Date): Promise<void>
  clearFailures(clientHash: string): Promise<void>
}

export type OperatorAuthDependencies = {
  store: OperatorStore
  secret: () => string | undefined
  now?: () => Date
  randomToken?: () => string
}

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()
export const hashOpaqueValue = (value: string) => digest(value).toString('hex')

export function credentialMatches(credential: string, configuredSecret: string | undefined) {
  if (!configuredSecret || !credential) return false
  return timingSafeEqual(digest(credential), digest(configuredSecret))
}

export function cookieToken(request: Request) {
  const header = request.headers.get('cookie') || ''
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === OPERATOR_COOKIE_NAME) return value.join('=') || null
  }
  return null
}

export function validMutationOrigin(request: Request) {
  const origin = request.headers.get('origin')
  return Boolean(origin && origin === new URL(request.url).origin)
}

const sessionCookie = (token: string, maxAge: number, secure: boolean) => {
  const attributes = [`${OPERATOR_COOKIE_NAME}=${token}`, 'Path=/api/operator', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Strict']
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

const response = (body: { authenticated: boolean }, status = 200, cookie?: string) => Response.json(body, {
  status,
  headers: cookie ? { 'Set-Cookie': cookie } : undefined,
})

const failure = (status = 401) => response({ authenticated: false }, status)

export function createOperatorAuthHandler(dependencies: OperatorAuthDependencies) {
  const now = dependencies.now || (() => new Date())
  const randomToken = dependencies.randomToken || (() => randomBytes(32).toString('base64url'))

  async function authenticated(request: Request) {
    const token = cookieToken(request)
    return token ? dependencies.store.findActiveSession(hashOpaqueValue(token), now()) : false
  }

  return async (request: Request, clientAddress: string | undefined) => {
    const url = new URL(request.url)
    const route = url.pathname.replace(/^\/api\/operator\/?/, '')
    const secure = url.protocol === 'https:'

    if (request.method === 'POST' && (route === 'login' || route === 'logout') && !validMutationOrigin(request)) {
      return failure(403)
    }

    if (request.method === 'POST' && route === 'login') {
      let body: unknown
      try { body = await request.json() } catch { return failure() }
      const credential = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).credential : undefined
      if (typeof credential !== 'string' || credential.trim().length === 0 || credential.length > 4096) return failure()

      const clientHash = hashOpaqueValue(clientAddress || 'unknown-client')
      const current = now()
      const since = new Date(current.getTime() - LOGIN_WINDOW_MS)
      if (await dependencies.store.countRecentFailures(clientHash, since) >= MAX_LOGIN_FAILURES) return failure(429)

      if (!credentialMatches(credential, dependencies.secret())) {
        await dependencies.store.recordFailure(clientHash, current)
        return failure()
      }

      await dependencies.store.clearFailures(clientHash)
      const token = randomToken()
      await dependencies.store.createSession({
        tokenHash: hashOpaqueValue(token),
        createdAt: current,
        expiresAt: new Date(current.getTime() + SESSION_DURATION_MS),
        revokedAt: null,
      })
      return response({ authenticated: true }, 200, sessionCookie(token, SESSION_DURATION_MS / 1000, secure))
    }

    if (request.method === 'GET' && route === 'session') {
      return response({ authenticated: await authenticated(request) })
    }

    if (request.method === 'POST' && route === 'logout') {
      const token = cookieToken(request)
      if (token) await dependencies.store.revokeSession(hashOpaqueValue(token), now())
      return response({ authenticated: false }, 200, sessionCookie('', 0, secure))
    }

    if (request.method === 'GET' && route === 'protected-check') {
      return await authenticated(request) ? response({ authenticated: true }) : failure()
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function hasOperatorSession(request: Request, store: OperatorStore, now = new Date()) {
  const token = cookieToken(request)
  return token ? store.findActiveSession(hashOpaqueValue(token), now) : false
}
