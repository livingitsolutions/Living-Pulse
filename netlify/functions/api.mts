import { randomUUID } from 'node:crypto'
import type { Config } from '@netlify/functions'
import { productOperationRepository } from '../../db/productOperationRepository.js'
import { createProductOperations, ProductOperationError } from '../../server/productOperations.js'

const operations = createProductOperations(productOperationRepository)
const json = (body: unknown, status = 200) => Response.json(body, { status })
const bad = (message: string, status = 400) => json({ error: message }, status)
const keyFor = (request: Request) => request.headers.get('idempotency-key')?.trim() || randomUUID()

export default async (req: Request) => {
  try {
    const parts = new URL(req.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
    if (req.method === 'POST' && parts[0] === 'events') {
      await operations.recordTelemetry(await req.json() as Record<string, unknown>, keyFor(req))
      return json({ ok: true }, 201)
    }
    if (req.method === 'POST' && parts[0] === 'pulses' && parts.length === 1) {
      const result = await operations.createPulse(await req.json() as Record<string, unknown>, keyFor(req))
      return json(result.value, 201)
    }
    const id = parts[1]
    if (!id) return bad('Not found', 404)
    if (req.method === 'GET' && parts[0] === 'pulses' && parts.length === 2) return json(await operations.getPublicPulse(id))
    if (req.method === 'POST' && parts[2] === 'responses') {
      await operations.submitResponse(id, await req.json() as Record<string, unknown>, keyFor(req))
      return json({ ok: true }, 201)
    }
    if (req.method === 'GET' && parts[2] === 'results') return json(await operations.getCreatorResults(id, req.headers.get('x-creator-key')?.trim().slice(0, 80) ?? ''))
    if (req.method === 'PATCH' && parts[2] === 'status') return json(await operations.updateLifecycle(id, await req.json() as Record<string, unknown>))
    if (req.method === 'POST' && parts[2] === 'feedback') {
      await operations.submitCreatorFeedback(id, await req.json() as Record<string, unknown>, keyFor(req))
      return json({ ok: true }, 201)
    }
    return bad('Not found', 404)
  } catch (error) {
    if (error instanceof ProductOperationError) return bad(error.message, error.status)
    console.error('API request failed')
    return bad('The request could not be completed.', 500)
  }
}

export const config: Config = { path: '/api/*' }
