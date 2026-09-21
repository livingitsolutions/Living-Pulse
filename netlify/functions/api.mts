import { randomUUID } from 'node:crypto'
import type { Config } from '@netlify/functions'
import { ProductServiceClient, ProductServiceUnavailableError } from '../../server/productServiceClient.js'

const json = (body: unknown, status = 200) => Response.json(body, { status })
const unavailable = () => json({ error: 'The request could not be completed.' }, 503)
const operationKey = (request: Request) => request.headers.get('idempotency-key')?.trim() || randomUUID()

async function browserResponse(response: Response) {
  if (response.status === 401 || response.status >= 500) return unavailable()
  const body = await response.text()
  return new Response(body, { status: response.status, headers: { 'content-type': 'application/json' } })
}

export default async (request: Request) => {
  try {
    const parts = new URL(request.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
    if (!['events', 'pulses'].includes(parts[0])) return json({ error: 'Not found' }, 404)
    const client = new ProductServiceClient({ baseUrl: Netlify.env.get('LIVING_PULSE_PRODUCT_SERVICE_URL'), secret: Netlify.env.get('LIVING_PULSE_PRODUCT_SERVICE_SECRET') })
    if (request.method === 'POST' && parts[0] === 'events') return browserResponse(await client.recordTelemetry(await request.json() as Record<string, unknown>, operationKey(request)))
    if (request.method === 'POST' && parts[0] === 'pulses' && parts.length === 1) return browserResponse(await client.createPulse(await request.json() as Record<string, unknown>, operationKey(request)))
    const id = parts[1]
    if (!id) return json({ error: 'Not found' }, 404)
    if (request.method === 'GET' && parts[0] === 'pulses' && parts.length === 2) return browserResponse(await client.getPublicPulse(id))
    if (request.method === 'POST' && parts[2] === 'responses') return browserResponse(await client.submitResponse(id, await request.json() as Record<string, unknown>, operationKey(request)))
    if (request.method === 'GET' && parts[2] === 'results') return browserResponse(await client.getCreatorResults(id, request.headers.get('x-creator-key')?.trim().slice(0, 80) ?? ''))
    if (request.method === 'PATCH' && parts[2] === 'status') return browserResponse(await client.updateLifecycle(id, await request.json() as Record<string, unknown>, operationKey(request)))
    if (request.method === 'POST' && parts[2] === 'feedback') return browserResponse(await client.submitCreatorFeedback(id, await request.json() as Record<string, unknown>, operationKey(request)))
    return json({ error: 'Not found' }, 404)
  } catch (caught) {
    if (!(caught instanceof ProductServiceUnavailableError)) console.error('Public API request failed')
    return unavailable()
  }
}

export const config: Config = { path: '/api/*' }
