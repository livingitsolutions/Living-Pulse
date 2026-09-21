import { boolean, integer, jsonb, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export type PulseOption = { id: string; label: string }
export type FollowUp = { question: string; options: PulseOption[] }

export const pulses = pgTable('pulses', {
  id: uuid('id').defaultRandom().primaryKey(),
  creatorKey: uuid('creator_key').defaultRandom().notNull(),
  businessName: text('business_name').notNull(),
  idea: text('idea').notNull(),
  question: text('question').notNull(),
  options: jsonb('options').$type<PulseOption[]>().notNull(),
  followUp: jsonb('follow_up').$type<FollowUp | null>(),
  allowUpdates: boolean('allow_updates').default(false).notNull(),
  status: text('status').default('Testing').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const responses = pgTable('responses', {
  id: serial('id').primaryKey(),
  pulseId: uuid('pulse_id').notNull().references(() => pulses.id, { onDelete: 'cascade' }),
  optionId: text('option_id').notNull(),
  followUpOptionId: text('follow_up_option_id'),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  pulseId: uuid('pulse_id'),
  sessionId: text('session_id'),
  metadata: jsonb('metadata').$type<Record<string, string | number | boolean>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const feedback = pgTable('feedback', {
  id: serial('id').primaryKey(),
  pulseId: uuid('pulse_id').notNull().references(() => pulses.id, { onDelete: 'cascade' }),
  decision: text('decision').notNull(),
  useful: text('useful').notNull(),
  affectedPlan: text('affected_plan').notNull(),
  useAgain: text('use_again').notNull(),
  worthPaying: text('worth_paying').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const counters = pgTable('counters', {
  id: serial('id').primaryKey(),
  value: integer('value').default(0).notNull(),
})
