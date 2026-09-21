import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { createProductServiceHandler } from './productServiceHandler.js'
import { ProductServiceClient, ProductServiceUnavailableError } from './productServiceClient.js'
import { ProductOperationError, type createProductOperations } from './productOperations.js'

const serviceRequest = (path: string, secret?: string, init: RequestInit = {}) => new Request(`https://growth.example/api/product-service/${path}`, { ...init, headers: { ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...init.headers } })

function fakeOperations() {
  return {
    recordTelemetry: vi.fn(async () => ({ value: { ok: true }, replayed: false })),
    createPulse: vi.fn(async () => ({ value: { id: 'pulse-1', creatorKey: 'creator-1' }, replayed: false })),
    getPublicPulse: vi.fn(async () => ({ id: 'pulse-1' })),
    submitResponse: vi.fn(async () => ({ value: { ok: true }, replayed: false })),
    getCreatorResults: vi.fn(async (_id: string, key: string) => { if (key !== 'creator-1') throw new ProductOperationError('Results access denied', 403); return { total: 0 } }),
    updateLifecycle: vi.fn(async () => ({ status: 'Launched' })),
    submitCreatorFeedback: vi.fn(async () => ({ value: { ok: true }, replayed: false })),
  } as unknown as ReturnType<typeof createProductOperations>
}

describe('Product Service security and operation boundary', () => {
  it.each([undefined, 'wrong', 'operator-secret', 'creator-1', 'idempotency-key'])('denies a non-service credential', async (credential) => {
    const response = await createProductServiceHandler({ operations: fakeOperations(), secret: () => 'service-secret' })(serviceRequest('pulses/pulse-1', credential))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication failed.' })
  })

  it('accepts service auth and forwards a stable idempotency key', async () => {
    const operations = fakeOperations()
    const handler = createProductServiceHandler({ operations, secret: () => 'service-secret' })
    const response = await handler(serviceRequest('pulses', 'service-secret', { method: 'POST', headers: { 'idempotency-key': 'stable-key' }, body: JSON.stringify({ businessName: 'A' }) }))
    expect(response.status).toBe(201)
    expect(operations.createPulse).toHaveBeenCalledWith({ businessName: 'A' }, 'stable-key')
    expect(JSON.stringify(await response.json())).not.toContain('service-secret')
  })

  it('routes every explicit product operation and no acquisition operation', async () => {
    const operations = fakeOperations()
    const handler = createProductServiceHandler({ operations, secret: () => 'service-secret' })
    const auth = 'service-secret'
    await handler(serviceRequest('events', auth, { method: 'POST', headers: { 'idempotency-key': 'e' }, body: '{}' }))
    await handler(serviceRequest('pulses/pulse-1', auth))
    await handler(serviceRequest('pulses/pulse-1/responses', auth, { method: 'POST', headers: { 'idempotency-key': 'r' }, body: '{}' }))
    await handler(serviceRequest('pulses/pulse-1/results', auth, { headers: { 'x-creator-key': 'creator-1' } }))
    await handler(serviceRequest('pulses/pulse-1/status', auth, { method: 'PATCH', body: '{}' }))
    await handler(serviceRequest('pulses/pulse-1/feedback', auth, { method: 'POST', headers: { 'idempotency-key': 'f' }, body: '{}' }))
    expect(operations.recordTelemetry).toHaveBeenCalledOnce()
    expect(operations.submitResponse).toHaveBeenCalledOnce()
    expect(operations.getCreatorResults).toHaveBeenCalledWith('pulse-1', 'creator-1')
    expect(operations.updateLifecycle).toHaveBeenCalledOnce()
    expect(operations.submitCreatorFeedback).toHaveBeenCalledOnce()
    expect((await handler(serviceRequest('pulses/pulse-1/results', auth, { headers: { 'x-creator-key': 'wrong' } }))).status).toBe(403)
    expect((await handler(serviceRequest('prospects', auth))).status).toBe(404)
  })
})

describe('Public ProductServiceClient', () => {
  it('uses configured URL, finite timeout, server credential, and the same key on retry', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetcher = vi.fn(async (input: URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} })
      return calls.length === 1 ? Response.json({ error: 'temporary' }, { status: 503 }) : Response.json({ ok: true }, { status: 201 })
    }) as typeof fetch
    const client = new ProductServiceClient({ baseUrl: 'https://growth-preview.netlify.app', secret: 'service-secret', fetch: fetcher, timeoutMs: 25 })
    const response = await client.createPulse({ idea: 'test' }, 'stable-key')
    expect(response.status).toBe(201)
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => new Headers(call.init.headers).get('idempotency-key') === 'stable-key')).toBe(true)
    expect(calls[0].url).toBe('https://growth-preview.netlify.app/api/product-service/pulses')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer service-secret')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it('does not retry a non-retryable client error and sanitizes unavailable configuration', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: 'bad request' }, { status: 400 })) as typeof fetch
    const client = new ProductServiceClient({ baseUrl: 'https://growth.example', secret: 'secret', fetch: fetcher })
    expect((await client.createPulse({}, 'key')).status).toBe(400)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(() => new ProductServiceClient({ baseUrl: undefined, secret: undefined })).toThrow(ProductServiceUnavailableError)
  })

  it('keeps the Public composition free of database authority', async () => {
    const [api, client, growth] = await Promise.all([readFile('netlify/functions/api.mts', 'utf8'), readFile('server/productServiceClient.ts', 'utf8'), readFile('netlify/growth-functions/api.mts', 'utf8')])
    expect(api).toContain('ProductServiceClient')
    expect(`${api}\n${client}`).not.toMatch(/db\/index|drizzle-orm\/netlify-db|acquisitionConsole|operatorStore|productOperationRepository/)
    expect(growth).toContain('productOperationRepository')
    expect(growth).toContain('/api/product-service/*')
    expect(api).toMatch(/response\.status === 401 \|\| response\.status >= 500/)
  })
})
