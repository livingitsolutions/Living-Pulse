# Durable product mutation idempotency

Date: 2026-09-21

Status: Foundation implemented; Product Service remains intentionally unimplemented

## Decision

Cross-site mutations can commit while their HTTP response is lost. A durable ledger now makes retry identity part of the same database transaction as the business mutation. The Growth/database-owning deployment remains the sole migration owner.

## Mutation classification

- **Idempotency required:** Pulse creation/publication; response submission (including written feedback and update opt-in); creator feedback; retryable standalone telemetry.
- **Naturally replay-safe:** setting lifecycle to the same validated status. This remains capability-protected and does not use the ledger.
- **No retryable mutation:** public Pulse retrieval and creator Results retrieval.
- Powered-by attribution and standalone observational events retain occurrence semantics: distinct occurrences use distinct keys; only transport retries sharing a key deduplicate. Pulse/response telemetry is atomically coupled to its parent operation.

## Ledger and scope

`product_operation_idempotency` stores a UUID identifier, operation scope, SHA-256 key hash, SHA-256 request fingerprint, `in_progress`/`completed` status, optional resource type/reference, and timestamps. A unique index on `(operation_scope, idempotency_key_hash)` prevents unrelated operation categories from colliding while serializing retries within one category.

Raw idempotency keys, creator capabilities, emails, feedback text, service/operator credentials, request bodies, and acquisition data are not stored. The repository contract receives only hashes.

## Fingerprint rules

Application validation and normalization run before fingerprinting. Object keys are recursively sorted; undefined object properties are omitted; array order is preserved; normalized optional values are explicit. SHA-256 is applied to this canonical representation. Thus the same logical request matches, while reuse of a key for another logical request fails with a generic 409 conflict. Fingerprinting does not change product validation semantics.

## Transaction and concurrency semantics

The Drizzle repository starts one transaction, claims with `INSERT ... ON CONFLICT DO NOTHING`, performs all coupled business writes, and marks the ledger complete before commit. Validation/database failures roll back both claim and writes, leaving retry possible. A competing transaction either observes the completed winner and replays or receives a deterministic in-progress response; it cannot execute a second mutation. No claim is committed separately from business state.

## Replay semantics

Pulse creation stores only `resource_type=pulse` and the Pulse ID, then re-reads the canonical row on replay. The existing Pulse row persists its generated creator capability, so replay returns exactly the same capability without placing it in the ledger or generating another one. Response, creator-feedback, and telemetry operations replay their fixed success result after confirming the completed resource reference.

Creator capability validation remains independent of idempotency. Feedback replay checks the capability again. Idempotency keys do not authorize Results, lifecycle, operator, or future Product Service access.

## Existing-client compatibility

The current browser contract is unchanged. A non-empty `Idempotency-Key` header is honored; when absent, the Public function generates a fresh server-side UUID for that single request. This preserves existing clients without falsely deduplicating separate browser actions. The future Public server will generate and retain stable keys across Product Service retries.

## Future Product Service use

The Product Service should call these application operations and forward stable caller-generated keys. It must still implement its separate server credential, finite timeout, creator dual authorization, and acquisition/operator isolation. This foundation does not implement that service, remove current Public database access, or alter deployment composition.
