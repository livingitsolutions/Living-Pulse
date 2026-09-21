import { describe, expect, it } from 'vitest'
import { collectWrittenFeedback, hasEnoughOptions, hasWrittenFeedbackQuestion, isWrittenFollowUp, percentage, WRITTEN_FEEDBACK_MAX_LENGTH, writtenFeedbackValue } from './validation'

describe('Pulse validation', () => {
  it('requires two non-empty response options', () => {
    expect(hasEnoughOptions([{ id: 'a', label: 'Yes' }, { id: 'b', label: '  ' }])).toBe(false)
    expect(hasEnoughOptions([{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }])).toBe(true)
  })

  it('keeps legacy multiple-choice follow-ups compatible', () => {
    const legacyFollowUp = { question: 'How often?', options: [{ id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' }] }
    expect(isWrittenFollowUp(legacyFollowUp)).toBe(false)
    expect(hasEnoughOptions(legacyFollowUp.options)).toBe(true)
  })

  it('requires a non-empty written-feedback question', () => {
    expect(hasWrittenFeedbackQuestion('  ')).toBe(false)
    expect(hasWrittenFeedbackQuestion('What would make this useful?')).toBe(true)
  })

  it('calculates rounded distributions and handles no responses', () => {
    expect(percentage(1, 3)).toBe(33)
    expect(percentage(0, 0)).toBe(0)
  })

  it('accepts absent and whitespace-only written feedback as absent', () => {
    expect(writtenFeedbackValue(undefined)).toEqual({ value: null, valid: true })
    expect(writtenFeedbackValue('   \n ')).toEqual({ value: null, valid: true })
  })

  it('trims and accepts written feedback through 1000 characters', () => {
    expect(writtenFeedbackValue('  useful after 6pm  ')).toEqual({ value: 'useful after 6pm', valid: true })
    expect(writtenFeedbackValue('a'.repeat(WRITTEN_FEEDBACK_MAX_LENGTH))).toEqual({ value: 'a'.repeat(WRITTEN_FEEDBACK_MAX_LENGTH), valid: true })
  })

  it('rejects written feedback over 1000 characters without altering its content', () => {
    const tooLong = 'a'.repeat(WRITTEN_FEEDBACK_MAX_LENGTH + 1)
    expect(writtenFeedbackValue(tooLong)).toEqual({ value: tooLong, valid: false })
  })

  it('keeps HTML-like input as plain text', () => {
    const input = '<img src=x onerror=alert(1)>'
    expect(writtenFeedbackValue(input)).toEqual({ value: input, valid: true })
  })

  it('retrieves only submitted written feedback for authorized results', () => {
    expect(collectWrittenFeedback([{ followUpText: null }, { followUpText: 'Actual response' }])).toEqual(['Actual response'])
  })
})
