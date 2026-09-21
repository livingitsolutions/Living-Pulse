import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export type PulseOption = { id: string; label: string }
export type FollowUp =
  | { type?: 'multiple_choice'; question: string; options: PulseOption[] }
  | { type: 'written_feedback'; question: string }

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
  followUpText: text('follow_up_text'),
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

export const acquisitionProspects = pgTable('acquisition_prospects', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessName: text('business_name').notNull(),
  websiteUrl: text('website_url'),
  publicContactEmail: text('public_contact_email').notNull(),
  normalizedEmail: text('normalized_email').notNull(),
  industry: text('industry'),
  locationText: text('location_text'),
  sourceUrl: text('source_url').notNull(),
  sourceType: text('source_type').notNull(),
  sourceObservedAt: timestamp('source_observed_at', { withTimezone: true }).notNull(),
  evidenceNote: text('evidence_note').notNull(),
  potentialUseCase: text('potential_use_case'),
  emailSourceUrl: text('email_source_url').notNull(),
  qualificationStatus: text('qualification_status').default('pending').notNull(),
  rejectionReason: text('rejection_reason'),
  outreachStatus: text('outreach_status').default('not_contacted').notNull(),
  personalizationContext: text('personalization_context'),
  personalizationEvidence: text('personalization_evidence'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('acquisition_prospects_normalized_email_unique').on(table.normalizedEmail),
  index('acquisition_prospects_outreach_status_idx').on(table.outreachStatus),
  check('acquisition_prospects_source_type_check', sql`${table.sourceType} in ('business_website', 'public_business_directory', 'public_social_business_page', 'manual')`),
  check('acquisition_prospects_qualification_status_check', sql`${table.qualificationStatus} in ('pending', 'qualified', 'rejected')`),
  check('acquisition_prospects_outreach_status_check', sql`${table.outreachStatus} in ('not_contacted', 'queued', 'sent', 'replied', 'converted', 'suppressed')`),
])

export const acquisitionSuppressions = pgTable('acquisition_suppressions', {
  normalizedEmail: text('normalized_email').primaryKey(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('acquisition_suppressions_email_idx').on(table.normalizedEmail),
  check('acquisition_suppressions_reason_check', sql`${table.reason} in ('unsubscribe', 'bounce', 'complaint', 'manual', 'invalid')`),
])

export const acquisitionOutreachAttempts = pgTable('acquisition_outreach_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  prospectId: uuid('prospect_id').notNull().references(() => acquisitionProspects.id, { onDelete: 'cascade' }),
  sequenceNumber: integer('sequence_number').notNull(),
  status: text('status').default('queued').notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  providerMessageId: text('provider_message_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('acquisition_attempts_prospect_sequence_unique').on(table.prospectId, table.sequenceNumber),
  index('acquisition_attempts_status_idx').on(table.status),
  check('acquisition_attempts_sequence_check', sql`${table.sequenceNumber} between 1 and 2`),
  check('acquisition_attempts_status_check', sql`${table.status} in ('queued', 'sent', 'cancelled')`),
])

export const acquisitionAuditEvents = pgTable('acquisition_audit_events', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  prospectId: uuid('prospect_id').references(() => acquisitionProspects.id, { onDelete: 'set null' }),
  attemptId: uuid('attempt_id').references(() => acquisitionOutreachAttempts.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').$type<Record<string, string | number | boolean>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('acquisition_audit_events_prospect_created_idx').on(table.prospectId, table.createdAt),
  check('acquisition_audit_events_name_check', sql`${table.name} in ('prospect_created', 'prospect_qualified', 'prospect_rejected', 'prospect_queued', 'prospect_suppressed', 'outreach_attempt_created', 'outreach_marked_sent', 'prospect_marked_replied', 'prospect_marked_converted')`),
])

export const operatorSessions = pgTable('operator_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('operator_sessions_expires_at_idx').on(table.expiresAt),
])

export const operatorLoginAttempts = pgTable('operator_login_attempts', {
  id: serial('id').primaryKey(),
  clientHash: text('client_hash').notNull(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull(),
}, (table) => [
  index('operator_login_attempts_client_time_idx').on(table.clientHash, table.attemptedAt),
])

export const productOperationIdempotency = pgTable('product_operation_idempotency', {
  id: uuid('id').defaultRandom().primaryKey(),
  operationScope: text('operation_scope').notNull(),
  idempotencyKeyHash: text('idempotency_key_hash').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  status: text('status').default('in_progress').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('product_idempotency_scope_key_unique').on(table.operationScope, table.idempotencyKeyHash),
  index('product_idempotency_created_at_idx').on(table.createdAt),
  check('product_idempotency_status_check', sql`${table.status} in ('in_progress', 'completed')`),
])
