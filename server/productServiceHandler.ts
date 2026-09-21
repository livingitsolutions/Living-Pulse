import type { createProductOperations } from './productOperations.js'
import { ProductOperationError } from './productOperations.js'
import { hasProductServiceCredential } from './productServiceAuth.js'

type ProductOperations = ReturnType<typeof createProductOperations>
type Dependencies = { operations: ProductOperations; secret: () => string | undefined }
const json = (body: unknown, status = 200) => Response.json(body, { status })
const error = (message: string, status: number) => json({ error: message }, status)
const idempotencyKey = (request: Request) => request.headers.get('idempotency-key')?.trim() ?? ''

export function createProductServiceHandler({ operations, secret }: Dependencies) {
  return async (request: Request) => {
    if (!hasProductServiceCredential(request, secret())) return error('Authentication failed.', 401)
    try {
      const parts = new URL(request.url).pathname.replace(/^\/api\/product-service\/?/, '').split('/').filter(Boolean)
      if (request.method === 'POST' && parts[0] === 'events') {
        await operations.recordTelemetry(await request.json() as Record<string, unknown>, idempotencyKey(request))
        return json({ ok: true }, 201)
      }
      if (request.method === 'POST' && parts[0] === 'pulses' && parts.length === 1) {
        const result = await operations.createPulse(await request.json() as Record<string, unknown>, idempotencyKey(request))
        return json(result.value, 201)
      }
      const id = parts[1]
      if (!id) return error('Not found', 404)
      if (request.method === 'GET' && parts[0] === 'pulses' && parts.length === 2) return json(await operations.getPublicPulse(id))
      if (request.method === 'POST' && parts[2] === 'responses') {
        await operations.submitResponse(id, await request.json() as Record<string, unknown>, idempotencyKey(request))
        return json({ ok: true }, 201)
      }
      if (request.method === 'GET' && parts[2] === 'results') return json(await operations.getCreatorResults(id, request.headers.get('x-creator-key')?.trim().slice(0, 80) ?? ''))
      if (request.method === 'PATCH' && parts[2] === 'status') return json(await operations.updateLifecycle(id, await request.json() as Record<string, unknown>))
      if (request.method === 'POST' && parts[2] === 'feedback') {
        await operations.submitCreatorFeedback(id, await request.json() as Record<string, unknown>, idempotencyKey(request))
        return json({ ok: true }, 201)
      }
      return error('Not found', 404)
    } catch (caught) {
      if (caught instanceof ProductOperationError) return error(caught.message, caught.status)
      console.error('Product Service request failed')
      return error('The request could not be completed.', 500)
    }
  }
}
