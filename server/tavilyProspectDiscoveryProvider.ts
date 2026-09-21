import {
  DiscoveryProviderUnavailableError,
  MAX_EVIDENCE_EXCERPT,
  isSafePublicUrl,
  type DiscoveryCandidate,
  type DiscoveryCriteria,
  type ProspectDiscoveryProvider,
} from '../src/prospectDiscovery.js'

const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search'
const REQUEST_TIMEOUT_MS = 7_000
const MAX_RESPONSE_BYTES = 1_000_000
/** A request may inspect at most 20 sources, even when ten accepted results are requested. */
export const MAX_UPSTREAM_RESULTS = 20
const PREFERRED_EXCERPT_LENGTH = 360

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type TavilySearchResult = { title?: unknown; url?: unknown; raw_content?: unknown }
type TavilySearchResponse = { results?: unknown }

const DIRECTORY_HOSTS = ['yelp.com', 'tripadvisor.com', 'yell.com', 'bbb.org', 'chamberofcommerce.com', 'yellowpages.com']
const SOCIAL_HOSTS = ['facebook.com', 'instagram.com', 'linkedin.com']
const UNSUPPORTED_HOSTS = ['tavily.com', 'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'x.com', 'twitter.com', 'youtube.com']

function hostMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function classifySource(sourceUrl: string): DiscoveryCandidate['sourceType'] | null {
  const url = new URL(sourceUrl)
  const hostname = url.hostname.toLowerCase()
  if (UNSUPPORTED_HOSTS.some((domain) => hostMatches(hostname, domain))) return null
  if (DIRECTORY_HOSTS.some((domain) => hostMatches(hostname, domain))) return 'public_business_directory'
  if (SOCIAL_HOSTS.some((domain) => hostMatches(hostname, domain))) return 'public_social_business_page'
  return 'business_website'
}

function businessNameFromTitle(title: string) {
  const name = title.split(/\s[|–—-]\s/)[0]?.trim()
  if (!name || name.length > 240) return null
  return name
}

function likelyOfficialWebsite(sourceUrl: string, businessName: string, email: string) {
  const hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '')
  const emailDomain = email.slice(email.lastIndexOf('@') + 1).toLowerCase()
  if (hostMatches(hostname, emailDomain) || hostMatches(emailDomain, hostname)) return true
  const compactHost = hostname.replace(/[^a-z0-9]/g, '')
  return businessName.toLowerCase().split(/[^a-z0-9]+/).some((token) => token.length >= 4 && compactHost.includes(token))
}

function extractEmails(content: string) {
  const matches = content.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi) ?? []
  return [...new Map(matches.filter((email) => email.length <= 320).map((email) => [email.toLocaleLowerCase('en-US'), email])).values()]
}

function excerptAround(content: string, email: string) {
  const index = content.toLocaleLowerCase('en-US').indexOf(email.toLocaleLowerCase('en-US'))
  if (index < 0) return null
  const budget = Math.min(PREFERRED_EXCERPT_LENGTH, MAX_EVIDENCE_EXCERPT)
  const start = Math.max(0, index - Math.floor((budget - email.length) / 2))
  const end = Math.min(content.length, start + budget)
  return content.slice(start, end).trim()
}

async function readBoundedJson(response: Response): Promise<TavilySearchResponse> {
  if (!response.body) throw new DiscoveryProviderUnavailableError()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new DiscoveryProviderUnavailableError()
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') throw new Error('malformed')
    return parsed as TavilySearchResponse
  } catch (error) {
    if (error instanceof DiscoveryProviderUnavailableError) throw error
    throw new DiscoveryProviderUnavailableError()
  }
}

function combineAbortSignals(signal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, timeoutMs)
  return {
    signal: controller.signal,
    dispose: () => { clearTimeout(timer); signal.removeEventListener('abort', abort) },
  }
}

export class TavilyProspectDiscoveryProvider implements ProspectDiscoveryProvider {
  readonly id = 'tavily_public_search'

  constructor(private readonly options: {
    apiKey: () => string | undefined
    fetch?: Fetch
    timeoutMs?: number
    now?: () => Date
  }) {}

  async discover(criteria: DiscoveryCriteria, signal: AbortSignal): Promise<DiscoveryCandidate[]> {
    const apiKey = this.options.apiKey()
    if (!apiKey) throw new DiscoveryProviderUnavailableError()
    const upstreamLimit = Math.min(MAX_UPSTREAM_RESULTS, Math.max(criteria.maxResults, criteria.maxResults * 3))
    const combined = combineAbortSignals(signal, this.options.timeoutMs ?? REQUEST_TIMEOUT_MS)
    try {
      const response = await (this.options.fetch ?? fetch)(TAVILY_SEARCH_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `${criteria.category} businesses in ${criteria.location} official website contact email`,
          search_depth: 'advanced',
          max_results: upstreamLimit,
          include_answer: false,
          include_images: false,
          include_raw_content: 'text',
        }),
        signal: combined.signal,
      })
      if (!response.ok) throw new DiscoveryProviderUnavailableError()

      const payload = await readBoundedJson(response)
      if (!Array.isArray(payload.results)) throw new DiscoveryProviderUnavailableError()
      const candidates: DiscoveryCandidate[] = []
      const seenEmails = new Set<string>()
      for (const rawResult of payload.results.slice(0, upstreamLimit) as TavilySearchResult[]) {
        if (candidates.length >= criteria.maxResults) break
        if (!rawResult || typeof rawResult !== 'object' || typeof rawResult.title !== 'string' || typeof rawResult.url !== 'string' || typeof rawResult.raw_content !== 'string') continue
        if (!isSafePublicUrl(rawResult.url) || rawResult.raw_content.length > MAX_RESPONSE_BYTES) continue
        const sourceType = classifySource(rawResult.url)
        const businessName = businessNameFromTitle(rawResult.title)
        if (!sourceType || !businessName) continue
        const email = extractEmails(rawResult.raw_content).find((value) => !seenEmails.has(value.toLocaleLowerCase('en-US')))
        if (!email) continue
        if (!rawResult.raw_content.toLocaleLowerCase('en-US').includes(businessName.toLocaleLowerCase('en-US'))) continue
        if (sourceType === 'business_website' && !likelyOfficialWebsite(rawResult.url, businessName, email)) continue
        const observedText = excerptAround(rawResult.raw_content, email)
        if (!observedText) continue
        seenEmails.add(email.toLocaleLowerCase('en-US'))
        const contentLower = rawResult.raw_content.toLocaleLowerCase('en-US')
        candidates.push({
          businessName,
          industry: contentLower.includes(criteria.category.toLocaleLowerCase('en-US')) ? criteria.category : null,
          locationText: contentLower.includes(criteria.location.toLocaleLowerCase('en-US')) ? criteria.location : null,
          websiteUrl: sourceType === 'business_website' ? rawResult.url : null,
          sourceType,
          sourceUrl: rawResult.url,
          sourceObservedAt: (this.options.now ?? (() => new Date()))().toISOString(),
          evidenceNote: 'Retrieved public source content identifies the business and displays the exact public email address.',
          potentialUseCase: null,
          personalizationContext: null,
          personalizationEvidence: null,
          publicEmailEvidence: { email, sourceUrl: rawResult.url, observedText },
        })
      }
      return candidates
    } catch {
      throw new DiscoveryProviderUnavailableError()
    } finally {
      combined.dispose()
    }
  }
}
