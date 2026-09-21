import type { FollowUp, PulseOption } from './types'

export function hasEnoughOptions(options: PulseOption[]) {
  return options.filter((option) => option.label.trim()).length >= 2
}

export function percentage(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0
}

export const WRITTEN_FEEDBACK_MAX_LENGTH = 1000

export function writtenFeedbackValue(value: unknown) {
  if (typeof value !== 'string') return { value: null, valid: true }
  const trimmed = value.trim()
  if (!trimmed) return { value: null, valid: true }
  return { value: trimmed, valid: trimmed.length <= WRITTEN_FEEDBACK_MAX_LENGTH }
}

export function isWrittenFollowUp(followUp: FollowUp | null): followUp is Extract<FollowUp, { type: 'written_feedback' }> {
  return followUp?.type === 'written_feedback'
}

export function hasWrittenFeedbackQuestion(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

export function collectWrittenFeedback(rows: Array<{ followUpText: string | null }>) {
  return rows.flatMap((row) => row.followUpText ? [row.followUpText] : [])
}
