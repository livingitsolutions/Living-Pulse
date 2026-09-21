import { describe, expect, it, vi } from 'vitest'
import { INFRASTRUCTURE_TEST_EMAIL, sendInfrastructureTestEmail } from '../netlify/functions/_shared/resend-infrastructure-test.mjs'
import { runInfrastructureTest } from '../netlify/functions/resend-infrastructure-test.mjs'

const apiKey = 'fake-api-key-for-tests'
const recipient = 'owner@example.test'

describe('Resend infrastructure test transport', () => {
  it('fails closed without an API key', async () => {
    const fetcher = vi.fn()
    await expect(sendInfrastructureTestEmail(undefined, recipient, fetcher)).resolves.toEqual({ ok: false, reason: 'missing_api_key' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fails closed without a test recipient', async () => {
    const fetcher = vi.fn()
    await expect(sendInfrastructureTestEmail(apiKey, undefined, fetcher)).resolves.toEqual({ ok: false, reason: 'missing_recipient' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sends the fixed payload using the Resend API structure', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'provider-id' }))

    await expect(sendInfrastructureTestEmail(apiKey, recipient, fetcher)).resolves.toEqual({ ok: true, id: 'provider-id' })

    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    })
    expect(JSON.parse(String(init.body))).toEqual({
      ...INFRASTRUCTURE_TEST_EMAIL,
      to: [recipient],
    })
  })

  it('sanitizes provider rejections and does not expose the secret', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(`Rejected ${apiKey}`, { status: 400 }))
    const result = await sendInfrastructureTestEmail(apiKey, recipient, fetcher)

    expect(result).toEqual({ ok: false, reason: 'provider_rejected' })
    expect(JSON.stringify(result)).not.toContain(apiKey)
  })

  it('sanitizes provider network failures', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(`Authorization: Bearer ${apiKey}`))
    const result = await sendInfrastructureTestEmail(apiKey, recipient, fetcher)

    expect(result).toEqual({ ok: false, reason: 'provider_unavailable' })
    expect(JSON.stringify(result)).not.toContain(apiKey)
  })

  it('does not return an unsafe provider message ID', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'unsafe\nlog-entry' }))

    await expect(sendInfrastructureTestEmail(apiKey, recipient, fetcher)).resolves.toEqual({ ok: true })
  })
})

describe('temporary deployment trigger', () => {
  it('reads only server environment values and supplies no caller-controlled content', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true })
    const log = vi.fn()
    const values: Record<string, string> = {
      RESEND_API_KEY: apiKey,
      LIVING_PULSE_TEST_EMAIL: recipient,
      recipient: 'attacker@example.test',
      subject: 'Attacker content',
      body: 'Attacker content',
    }

    await runInfrastructureTest({ getEnvironmentVariable: (name) => values[name], send, log })

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(apiKey, recipient)
    expect(log).toHaveBeenCalledWith('Living Pulse email infrastructure test: send attempted')
    expect(log).toHaveBeenCalledWith('Living Pulse email infrastructure test: send succeeded')
  })

  it('logs only a generic sanitized failure', async () => {
    const log = vi.fn()
    await runInfrastructureTest({
      getEnvironmentVariable: () => apiKey,
      send: async () => ({ ok: false, reason: 'provider_rejected' }),
      log,
    })

    expect(log).toHaveBeenLastCalledWith('Living Pulse email infrastructure test: send failed; provider rejected request')
    expect(JSON.stringify(log.mock.calls)).not.toContain(apiKey)
  })
})
