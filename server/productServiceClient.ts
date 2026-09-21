import { randomUUID } from 'node:crypto'

type ClientOptions = { baseUrl: string | undefined; secret: string | undefined; fetch?: typeof globalThis.fetch; timeoutMs?: number }
export class ProductServiceUnavailableError extends Error {}

export class ProductServiceClient {
  private readonly baseUrl: URL
  private readonly fetcher: typeof globalThis.fetch
  private readonly timeoutMs: number

  constructor(private readonly options: ClientOptions) {
    if (!options.baseUrl || !options.secret) throw new ProductServiceUnavailableError('Product service unavailable')
    try { this.baseUrl = new URL(options.baseUrl) } catch { throw new ProductServiceUnavailableError('Product service unavailable') }
    if (!['http:', 'https:'].includes(this.baseUrl.protocol)) throw new ProductServiceUnavailableError('Product service unavailable')
    if (this.baseUrl.username || this.baseUrl.password || this.baseUrl.search || this.baseUrl.hash) throw new ProductServiceUnavailableError('Product service unavailable')
    if (this.baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(this.baseUrl.hostname)) throw new ProductServiceUnavailableError('Product service unavailable')
    this.fetcher = options.fetch ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 5000
  }

  private async request(path: string, init: RequestInit, retrySafe: boolean, key?: string) {
    const attempts = retrySafe ? 2 : 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await this.fetcher(new URL(`/api/product-service/${path}`, this.baseUrl), {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.secret}`, ...(key ? { 'idempotency-key': key } : {}), ...init.headers },
        })
        if (response.status >= 500 && attempt + 1 < attempts) continue
        return response
      } catch {
        if (attempt + 1 >= attempts) throw new ProductServiceUnavailableError('Product service unavailable')
      }
    }
    throw new ProductServiceUnavailableError('Product service unavailable')
  }

  private mutation(path: string, method: 'POST' | 'PATCH', body: unknown, key: string = randomUUID(), retrySafe = true) {
    return this.request(path, { method, body: JSON.stringify(body) }, retrySafe, key)
  }
  private read(path: string, headers?: Headers | Record<string, string>) { return this.request(path, { method: 'GET', headers }, true) }

  recordTelemetry(body: Record<string, unknown>, key: string) { return this.mutation('events', 'POST', body, key) }
  createPulse(body: Record<string, unknown>, key: string) { return this.mutation('pulses', 'POST', body, key) }
  getPublicPulse(id: string) { return this.read(`pulses/${encodeURIComponent(id)}`) }
  submitResponse(id: string, body: Record<string, unknown>, key: string) { return this.mutation(`pulses/${encodeURIComponent(id)}/responses`, 'POST', body, key) }
  getCreatorResults(id: string, creatorKey: string) { return this.read(`pulses/${encodeURIComponent(id)}/results`, { 'x-creator-key': creatorKey }) }
  updateLifecycle(id: string, body: Record<string, unknown>, key: string) { return this.mutation(`pulses/${encodeURIComponent(id)}/status`, 'PATCH', body, key) }
  submitCreatorFeedback(id: string, body: Record<string, unknown>, key: string) { return this.mutation(`pulses/${encodeURIComponent(id)}/feedback`, 'POST', body, key) }
}
