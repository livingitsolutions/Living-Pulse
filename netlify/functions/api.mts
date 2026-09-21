import type { Config } from '@netlify/functions'
import { and, count, eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { events, feedback, pulses, responses } from '../../db/schema.js'
import { parseAttribution } from '../../src/acquisition.js'

const statuses = ['Draft', 'Testing', 'Planned', 'Coming Soon', 'Launched', 'Archived']
const eventNames = ['landing_viewed', 'create_started', 'pulse_created', 'pulse_published', 'pulse_link_copied', 'qr_downloaded', 'public_pulse_viewed', 'response_started', 'response_completed', 'update_opt_in', 'results_viewed', 'second_pulse_created', 'powered_by_clicked']
const json = (body: unknown, status = 200) => Response.json(body, { status })
const bad = (message: string, status = 400) => json({ error: message }, status)
const clean = (value: unknown, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : ''

async function owned(id: string, key: string) {
  const [pulse] = await db.select().from(pulses).where(and(eq(pulses.id, id), eq(pulses.creatorKey, key))).limit(1)
  return pulse
}

export default async (req: Request) => {
  try {
    const url = new URL(req.url)
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)

    if (req.method === 'POST' && parts[0] === 'events') {
      const body = await req.json() as Record<string, unknown>
      if (!eventNames.includes(String(body.name))) return bad('Unknown event')
      const metadata = body.name === 'powered_by_clicked' ? parseAttribution({ source: (body.metadata as Record<string, unknown> | null)?.source, sourcePulseId: body.pulseId }) : typeof body.metadata === 'object' ? body.metadata as Record<string, string | number | boolean> : null
      await db.insert(events).values({ name: String(body.name), pulseId: clean(body.pulseId) || null, sessionId: clean(body.sessionId, 100) || null, metadata })
      return json({ ok: true }, 201)
    }

    if (req.method === 'POST' && parts[0] === 'pulses' && parts.length === 1) {
      const body = await req.json() as Record<string, unknown>
      const options = Array.isArray(body.options) ? body.options.map((option) => ({ id: clean((option as Record<string, unknown>).id, 80), label: clean((option as Record<string, unknown>).label, 120) })).filter((o) => o.id && o.label) : []
      if (!clean(body.businessName, 120) || !clean(body.idea, 160) || !clean(body.question, 300) || options.length < 2) return bad('Business name, idea, question, and at least two options are required.')
      let followUp = null
      if (body.followUp && typeof body.followUp === 'object') {
        const raw = body.followUp as Record<string, unknown>
        const followOptions = Array.isArray(raw.options) ? raw.options.map((option) => ({ id: clean((option as Record<string, unknown>).id, 80), label: clean((option as Record<string, unknown>).label, 120) })).filter((o) => o.id && o.label) : []
        if (!clean(raw.question, 300) || followOptions.length < 2) return bad('A follow-up needs a question and at least two options.')
        followUp = { question: clean(raw.question, 300), options: followOptions }
      }
      const sessionId = clean(body.sessionId, 100)
      const acquisition = parseAttribution(body.acquisition)
      const prior = sessionId ? await db.select({ value: count() }).from(events).where(and(eq(events.sessionId, sessionId), eq(events.name, 'pulse_created'))) : [{ value: 0 }]
      const [pulse] = await db.insert(pulses).values({ businessName: clean(body.businessName, 120), idea: clean(body.idea, 160), question: clean(body.question, 300), options, followUp, allowUpdates: body.allowUpdates === true, status: 'Testing' }).returning()
      await db.insert(events).values([{ name: 'pulse_created', pulseId: pulse.id, sessionId, metadata: acquisition }, { name: 'pulse_published', pulseId: pulse.id, sessionId, metadata: acquisition }, ...(prior[0].value > 0 ? [{ name: 'second_pulse_created', pulseId: pulse.id, sessionId, metadata: acquisition }] : [])])
      return json(pulse, 201)
    }

    const id = parts[1]
    if (!id) return bad('Not found', 404)
    if (req.method === 'GET' && parts[0] === 'pulses' && parts.length === 2) {
      const [pulse] = await db.select({ id: pulses.id, businessName: pulses.businessName, idea: pulses.idea, question: pulses.question, options: pulses.options, followUp: pulses.followUp, allowUpdates: pulses.allowUpdates, status: pulses.status, createdAt: pulses.createdAt }).from(pulses).where(eq(pulses.id, id)).limit(1)
      return pulse ? json(pulse) : bad('Pulse not found', 404)
    }
    if (req.method === 'POST' && parts[2] === 'responses') {
      const body = await req.json() as Record<string, unknown>
      const [pulse] = await db.select().from(pulses).where(eq(pulses.id, id)).limit(1)
      if (!pulse) return bad('Pulse not found', 404)
      const optionId = clean(body.optionId, 80)
      if (!pulse.options.some((option) => option.id === optionId)) return bad('Choose a valid response.')
      const followUpOptionId = clean(body.followUpOptionId, 80) || null
      if (pulse.followUp && !pulse.followUp.options.some((option) => option.id === followUpOptionId)) return bad('Choose a follow-up response.')
      const email = pulse.allowUpdates ? clean(body.email, 320).toLowerCase() || null : null
      if (email && !/^\S+@\S+\.\S+$/.test(email)) return bad('Enter a valid email address.')
      await db.insert(responses).values({ pulseId: id, optionId, followUpOptionId, email })
      await db.insert(events).values([{ name: 'response_completed', pulseId: id, sessionId: clean(body.sessionId, 100) }, ...(email ? [{ name: 'update_opt_in', pulseId: id, sessionId: clean(body.sessionId, 100) }] : [])])
      return json({ ok: true }, 201)
    }
    if (req.method === 'GET' && parts[2] === 'results') {
      const pulse = await owned(id, clean(url.searchParams.get('key'), 80))
      if (!pulse) return bad('Results access denied', 403)
      const rows = await db.select().from(responses).where(eq(responses.pulseId, id))
      const total = rows.length
      const aggregate = (options: typeof pulse.options, field: 'optionId' | 'followUpOptionId') => options.map((option) => { const optionCount = rows.filter((row) => row[field] === option.id).length; return { ...option, count: optionCount, percentage: total ? Math.round(optionCount / total * 100) : 0 } })
      return json({ pulse, total, options: aggregate(pulse.options, 'optionId'), followUp: pulse.followUp ? aggregate(pulse.followUp.options, 'followUpOptionId') : [], updateOptIns: rows.filter((row) => row.email).length })
    }
    if (req.method === 'PATCH' && parts[2] === 'status') {
      const body = await req.json() as Record<string, unknown>
      const status = clean(body.status, 30)
      if (!statuses.includes(status) || !await owned(id, clean(body.key, 80))) return bad('Invalid status or access denied', 403)
      await db.update(pulses).set({ status }).where(eq(pulses.id, id))
      return json({ status })
    }
    if (req.method === 'POST' && parts[2] === 'feedback') {
      const body = await req.json() as Record<string, unknown>
      if (!await owned(id, clean(body.key, 80))) return bad('Access denied', 403)
      const values = { decision: clean(body.decision, 1000), useful: clean(body.useful, 1000), affectedPlan: clean(body.affectedPlan, 1000), useAgain: clean(body.useAgain, 1000), worthPaying: clean(body.worthPaying, 1000) }
      if (Object.values(values).some((value) => !value)) return bad('Please answer every feedback question.')
      await db.insert(feedback).values({ pulseId: id, ...values })
      return json({ ok: true }, 201)
    }
    return bad('Not found', 404)
  } catch (error) {
    console.error('API request failed', error instanceof Error ? error.message : 'Unknown error')
    return bad('The request could not be completed.', 500)
  }
}

export const config: Config = { path: '/api/*' }
