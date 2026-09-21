# Internal Product Service audit and idempotency blocker

Date: 2026-09-21

Status: Blocked pending explicit approval for an additive database migration

## Why implementation stopped

Moving public mutations across a network boundary introduces ambiguous outcomes: the database-owning service can commit successfully while the Public function times out before receiving the response. Retrying the current operations can duplicate Pulses, responses, feedback, and telemetry. The existing schema has no durable idempotency key or operation ledger.

An in-memory cache, browser state, function-instance state, or “do not retry” policy does not safely resolve ambiguous commits. Durable idempotency must be written in the same database transaction as the product mutation. That requires an additive migration. Sprint -1A.9.3 explicitly prohibits creating such a migration without approval, so no Product Service or client was implemented.

## Current product database operation map

All operations currently live in `netlify/functions/api.mts` and directly use `db/index.ts` plus Drizzle schema tables.

### Record telemetry

- Browser route: `POST /api/events`.
- Tables: inserts one `events` row.
- Validation: event name must be in the fixed allowlist. Powered-by metadata is reduced through `parseAttribution`; other object metadata is accepted as the current record shape.
- Attribution: stores powered-by source/source Pulse ID. Session ID supports later second-Pulse detection.
- Capability: none; telemetry is anonymous.
- Response: `201 { "ok": true }`; unknown name returns 400; unexpected parsing/database failure returns sanitized 500.
- Transaction: one insert; no explicit transaction.
- Retry risk: duplicate telemetry rows and inflated product/attribution counts.

### Create and publish a Pulse

- Browser route: `POST /api/pulses`.
- Tables: reads `events` for previous session Pulse creation; inserts `pulses`; inserts `pulse_created`, `pulse_published`, and conditionally `second_pulse_created` events.
- Validation: trimmed/length-limited business name, idea, question, option IDs/labels, minimum two options, optional multiple-choice or written-feedback follow-up validation, attribution parsing.
- Capability: database generates `creator_key`; returned only in the created Pulse response for creator use.
- Response: full created Pulse with creator capability, status 201. Validation errors retain existing messages/status 400.
- Transaction: currently multiple independent statements with no explicit transaction. The Product Service must expose this as one operation; an approved implementation should make the writes and idempotency record atomic.
- Retry risk: duplicate Pulses, capabilities, publication events, and second-Pulse attribution.

### Retrieve a public Pulse

- Browser route: `GET /api/pulses/:id`.
- Tables: reads `pulses` with a public-field projection.
- Validation: Pulse ID/path lookup.
- Capability: none; public operation.
- Response: public Pulse fields, 200; `Pulse not found`, 404.
- Transaction/idempotency: read-only; no idempotency required.

### Submit response, written feedback, and update opt-in

- Browser route: `POST /api/pulses/:id/responses`.
- Tables: reads `pulses`; inserts `responses`; inserts `response_completed` and optionally `update_opt_in` events.
- Validation: Pulse existence; primary option membership; multiple-choice follow-up membership; written follow-up rejects option IDs; written feedback is trimmed and limited to 1000 characters; feedback is rejected when not configured; optional email is stored only when updates are enabled and must match the current email pattern.
- Capability: none; anonymous respondent operation transported by the authenticated Public server.
- Response: `201 { "ok": true }`; current validation errors and Pulse 404 remain part of the public contract.
- Transaction: currently multiple independent statements with no explicit transaction. The Product Service must expose one response-submission operation and atomically persist the response, derived events, and idempotency claim.
- Retry risk: duplicate response, duplicate written feedback, duplicate update opt-in count, and duplicate telemetry.

### Retrieve creator Results

- Browser route: `GET /api/pulses/:id/results` with `X-Creator-Key`.
- Tables: reads `pulses` by both ID and `creator_key`; reads `responses`.
- Validation/authorization: matching creator capability is mandatory. The server-to-server credential must never replace it.
- Response: safe Pulse without `creatorKey`, total, option/follow-up aggregates, collected written feedback, and update-opt-in count; denial is 403.
- Transaction/idempotency: read-only; no idempotency required.

### Update lifecycle/status

- Browser route: `PATCH /api/pulses/:id/status`.
- Tables: reads `pulses` by ID/capability; updates `pulses.status`.
- Validation/authorization: status must be one of Draft, Testing, Planned, Coming Soon, Launched, Archived; matching creator capability is mandatory.
- Response: `{ "status": value }`; current invalid-status/access failure is 403.
- Transaction: one update after authorization read; no explicit transaction.
- Retry risk: replaying the same desired status is naturally idempotent. A future request key/fingerprint can still prevent accidental key reuse with a different payload, but this operation does not independently force the migration.

### Submit creator feedback

- Browser route: `POST /api/pulses/:id/feedback`.
- Tables: reads `pulses` by ID/capability; inserts `feedback`.
- Validation/authorization: matching creator capability; all five fields required after trimming and capped at 1000 characters.
- Response: `201 { "ok": true }`; access denial 403; incomplete feedback 400.
- Transaction: one insert after authorization read; no explicit transaction.
- Retry risk: duplicate feedback rows after an ambiguous response.

## Minimum durable idempotency requirement

An approved follow-up migration should add a small product-operation idempotency ledger rather than adding unrelated infrastructure. The final schema design requires review, but it minimally needs:

- an operation scope;
- a caller-supplied opaque idempotency key;
- a hash/fingerprint of the normalized request to reject key reuse with different input;
- the created resource identifier where applicable;
- creation/retention timestamps;
- a uniqueness constraint on operation scope plus key.

It must not persist the Product Service secret, creator capability, respondent email, written feedback, or raw sensitive request bodies. Pulse creation can reconstruct its response from the stored resource ID. Other operations can return their fixed response after confirming the matching fingerprint.

The idempotency claim and business writes must occur in one database transaction. Concurrent requests for the same key must converge on one committed outcome. Pulse creation/publication, response submission, creator feedback, and telemetry recording require this boundary before cross-site deployment.

The existing Growth/database-owning project remains the sole migration owner.

## Intended Product Service design after approval

- Growth-only function namespace distinct from `/api/operator/*`.
- Explicit operations only: record telemetry, create Pulse, get public Pulse, submit response, get creator Results, update lifecycle, submit creator feedback.
- Authentication with server-only `LIVING_PULSE_PRODUCT_SERVICE_SECRET`, constant-time verification, generic denial, and no credential logging/persistence.
- Public server client configured by server-only `LIVING_PULSE_PRODUCT_SERVICE_URL` and the same service secret.
- Finite request timeout and sanitized browser-compatible errors.
- No wildcard CORS; authentication is mandatory regardless of origin.
- Creator-protected operations require both valid service authentication and the existing creator capability.
- Anonymous Pulse reads and response submissions remain anonymous at the product-authorization layer after authenticated server transport.
- No acquisition, operator, delivery, environment, arbitrary SQL, or generic table operations.
- Minimal sanitized logs containing operation name, generic outcome category, and optional platform request ID only.

## Environment ownership after approval

Growth/database owner may hold:

- `LIVING_PULSE_PRODUCT_SERVICE_SECRET`
- `LIVING_PULSE_OPERATOR_SECRET`
- future `RESEND_API_KEY`
- future `ACQUISITION_SENDING_ENABLED`

Public may hold only:

- `LIVING_PULSE_PRODUCT_SERVICE_URL`
- `LIVING_PULSE_PRODUCT_SERVICE_SECRET`

No value may be placed in a `VITE_*` variable or exposed to browser code.

## Required next decision

Approve an additive migration for a product-operation idempotency ledger and the associated transaction refactor. After approval, implement and test the Product Service, typed timeout-bound client, unchanged browser API facade, service/operator isolation, creator dual authorization, and public no-database composition.

DATABASE MIGRATION REQUIRED
