const RESEND_URL = 'https://api.resend.com/emails'

export const INFRASTRUCTURE_TEST_EMAIL = {
  from: 'Living Pulse <hello@send.livingitsolutions.com>',
  reply_to: 'pulse@livingitsolutions.com',
  subject: 'Living Pulse email infrastructure test',
  text: `This is a test email from Living Pulse.

If you received this message, server-side outbound email is working.

Please reply to this email to verify the Living Pulse reply address.`,
} as const

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type SendResult =
  | { ok: true; id?: string }
  | { ok: false; reason: 'missing_api_key' | 'missing_recipient' | 'provider_rejected' | 'provider_unavailable' }

export async function sendInfrastructureTestEmail(
  apiKey: string | undefined,
  recipient: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<SendResult> {
  if (!apiKey) return { ok: false, reason: 'missing_api_key' }
  if (!recipient) return { ok: false, reason: 'missing_recipient' }

  try {
    const response = await fetcher(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...INFRASTRUCTURE_TEST_EMAIL,
        to: [recipient],
      }),
    })

    if (!response.ok) return { ok: false, reason: 'provider_rejected' }

    const data = await response.json().catch(() => null) as { id?: unknown } | null
    const id = typeof data?.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(data.id) ? data.id : undefined
    return { ok: true, ...(id ? { id } : {}) }
  } catch {
    return { ok: false, reason: 'provider_unavailable' }
  }
}
