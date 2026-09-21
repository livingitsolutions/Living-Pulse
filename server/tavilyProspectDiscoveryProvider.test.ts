import { describe, expect, it, vi } from 'vitest'
import { DiscoveryProviderUnavailableError, validateDiscoveryCandidate, type DiscoveryCriteria } from '../src/prospectDiscovery'
import { MAX_UPSTREAM_RESULTS, TavilyProspectDiscoveryProvider } from './tavilyProspectDiscoveryProvider'

const criteria: DiscoveryCriteria = { category: 'Cafe', location: 'Bristol', maxResults: 2 }
const secret = 'test-secret-that-must-not-leak'
const result = (overrides: Record<string, unknown> = {}) => ({
  title: 'Harbour Coffee | Official site',
  url: 'https://harbour.example/contact',
  raw_content: 'Harbour Coffee is a Cafe in Bristol. Public enquiries: Sales@Harbour.Example. Open daily.',
  ...overrides,
})
const response = (results: unknown[], status = 200) => new Response(JSON.stringify({ results }), { status, headers: { 'Content-Type': 'application/json' } })
const provider = (fetcher: typeof fetch, options: { key?: string; timeoutMs?: number } = {}) => new TavilyProspectDiscoveryProvider({
  apiKey: () => options.key ?? secret,
  fetch: fetcher,
  timeoutMs: options.timeoutMs,
  now: () => new Date('2026-09-21T10:00:00Z'),
})

describe('Tavily prospect discovery adapter', () => {
  it('fails closed without a key and never calls the transport', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(provider(fetcher, { key: '' }).discover(criteria, new AbortController().signal)).rejects.toBeInstanceOf(DiscoveryProviderUnavailableError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sends bounded server-owned parameters only to the code-owned endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response([]))
    await provider(fetcher).discover({ ...criteria, maxResults: 10 }, new AbortController().signal)
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.tavily.com/search')
    expect(JSON.parse(String(init?.body))).toEqual({ query: 'Cafe businesses in Bristol official website contact email', search_depth: 'advanced', max_results: MAX_UPSTREAM_RESULTS, include_answer: false, include_images: false, include_raw_content: 'text' })
  })

  it.each([401, 403, 429, 500, 503])('returns a credential-safe failure for upstream %s', async (status) => {
    const upstreamBody = `${secret} private upstream details`
    const operation = provider(vi.fn(async () => new Response(upstreamBody, { status }))).discover(criteria, new AbortController().signal)
    const error = await operation.catch((value: unknown) => value)
    expect(error).toBeInstanceOf(DiscoveryProviderUnavailableError)
    expect(JSON.stringify(error)).not.toContain(secret)
    expect(String((error as Error).message)).not.toContain(upstreamBody)
  })

  it('rejects malformed and oversized provider responses safely', async () => {
    await expect(provider(vi.fn(async () => new Response('{bad json'))).discover(criteria, new AbortController().signal)).rejects.toBeInstanceOf(DiscoveryProviderUnavailableError)
    await expect(provider(vi.fn(async () => new Response('x'.repeat(1_000_001)))).discover(criteria, new AbortController().signal)).rejects.toBeInstanceOf(DiscoveryProviderUnavailableError)
  })

  it('respects both the caller abort signal and request timeout', async () => {
    const waitingFetch: typeof fetch = (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
    const caller = new AbortController()
    const callerOperation = provider(waitingFetch, { timeoutMs: 1_000 }).discover(criteria, caller.signal)
    caller.abort()
    await expect(callerOperation).rejects.toBeInstanceOf(DiscoveryProviderUnavailableError)
    await expect(provider(waitingFetch, { timeoutMs: 5 }).discover(criteria, new AbortController().signal)).rejects.toBeInstanceOf(DiscoveryProviderUnavailableError)
  })

  it('returns zero for no results, missing emails, unsafe URLs, and unsupported sources', async () => {
    const values = [result({ raw_content: 'No published address.' }), result({ url: 'http://127.0.0.1/contact' }), result({ url: 'https://tavily.com/result' }), result({ url: 'https://publisher.example/story', raw_content: 'Harbour Coffee Cafe Bristol. Sales@Harbour.Example' })]
    expect(await provider(vi.fn(async () => response([]))).discover(criteria, new AbortController().signal)).toEqual([])
    expect(await provider(vi.fn(async () => response(values))).discover(criteria, new AbortController().signal)).toEqual([])
  })

  it('accepts exact observed evidence, retains original casing/context, and classifies supported sources', async () => {
    const values = [result(), result({ title: 'Directory Cafe - Listing', url: 'https://www.yelp.com/biz/directory-cafe', raw_content: 'Directory Cafe Bristol email hello@directory.example' })]
    const candidates = await provider(vi.fn(async () => response(values))).discover(criteria, new AbortController().signal)
    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({ businessName: 'Harbour Coffee', sourceType: 'business_website', publicEmailEvidence: { email: 'Sales@Harbour.Example' } })
    expect(candidates[0].publicEmailEvidence.observedText).toContain('Sales@Harbour.Example')
    expect(validateDiscoveryCandidate({ ...candidates[0], publicEmailEvidence: { ...candidates[0].publicEmailEvidence, email: 'sales@harbour.example' } }).publicEmailEvidence.email).toBe('sales@harbour.example')
    expect(candidates[1].sourceType).toBe('public_business_directory')
  })

  it('bounds accepted results, upstream inspection, evidence size, and normalized-email duplicates', async () => {
    const values = Array.from({ length: 30 }, (_, index) => result({ title: `Cafe ${index}`, url: `https://cafe${index}.example/contact`, raw_content: `Cafe ${index}. ${'context '.repeat(100)} SAME@EXAMPLE.COM ${'more '.repeat(100)}` }))
    const candidates = await provider(vi.fn(async () => response(values))).discover({ ...criteria, maxResults: 10 }, new AbortController().signal)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].publicEmailEvidence.observedText.length).toBeLessThanOrEqual(360)
  })
})
