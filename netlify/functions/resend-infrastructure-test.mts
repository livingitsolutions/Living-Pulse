import type { DeploySucceededEvent } from '@netlify/functions'
import { sendInfrastructureTestEmail, type SendResult } from './_shared/resend-infrastructure-test.mjs'

type TestDependencies = {
  getEnvironmentVariable: (name: string) => string | undefined
  send: (apiKey: string | undefined, recipient: string | undefined) => Promise<SendResult>
  log: (message: string) => void
}

export async function runInfrastructureTest({ getEnvironmentVariable, send, log }: TestDependencies) {
  log('Living Pulse email infrastructure test: send attempted')

  const result = await send(
    getEnvironmentVariable('RESEND_API_KEY'),
    getEnvironmentVariable('LIVING_PULSE_TEST_EMAIL'),
  )

  if (result.ok) {
    log(result.id
      ? `Living Pulse email infrastructure test: send succeeded; provider message ID ${result.id}`
      : 'Living Pulse email infrastructure test: send succeeded')
    return
  }

  const statuses: Record<Exclude<SendResult, { ok: true }>['reason'], string> = {
    missing_api_key: 'configuration unavailable',
    missing_recipient: 'configuration unavailable',
    provider_rejected: 'provider rejected request',
    provider_unavailable: 'provider unavailable',
  }
  log(`Living Pulse email infrastructure test: send failed; ${statuses[result.reason]}`)
}

export default {
  async deploySucceeded(event: DeploySucceededEvent) {
    void event
    await runInfrastructureTest({
      getEnvironmentVariable: (name) => Netlify.env.get(name),
      send: sendInfrastructureTestEmail,
      log: console.log,
    })
  },
}
