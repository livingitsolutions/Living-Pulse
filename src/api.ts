import type { EventName, Pulse, Results } from './types'
import type { AcquisitionAttribution } from './acquisition'

const SESSION_KEY = 'living-pulse-session'
export function sessionId() {
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, id) }
  return id
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((data as { error?: string }).error || 'Something went wrong')
  return data as T
}
export const api = {
  create: (pulse: Omit<Pulse, 'id' | 'status'>, acquisition?: AcquisitionAttribution | null) => request<Pulse>('/pulses', { method: 'POST', body: JSON.stringify({ ...pulse, sessionId: sessionId(), acquisition }) }),
  pulse: (id: string) => request<Pulse>(`/pulses/${id}`),
  results: (id: string, key: string) => request<Results>(`/pulses/${id}/results?key=${encodeURIComponent(key)}`),
  respond: (id: string, payload: { optionId: string; followUpOptionId?: string; email?: string }) => request(`/pulses/${id}/responses`, { method: 'POST', body: JSON.stringify({ ...payload, sessionId: sessionId() }) }),
  status: (id: string, key: string, status: string) => request(`/pulses/${id}/status`, { method: 'PATCH', body: JSON.stringify({ key, status }) }),
  feedback: (id: string, key: string, payload: Record<string, string>) => request(`/pulses/${id}/feedback`, { method: 'POST', body: JSON.stringify({ key, ...payload }) }),
  event: (name: EventName, pulseId?: string, metadata?: Record<string, string | number | boolean>) => request('/events', { method: 'POST', body: JSON.stringify({ name, pulseId, sessionId: sessionId(), metadata }) }).catch(() => undefined),
}
