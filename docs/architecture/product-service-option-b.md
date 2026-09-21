# Option B — Internal Product Service implementation

Date: 2026-09-21

Status: Implemented in repository; not deployed

## Final topology

```text
Browser
  -> Public UI and /api/* facade (no database binding)
  -> authenticated server-to-server HTTP
  -> Growth /api/product-service/*
  -> product application operations and repositories
  -> Netlify Database
```

The existing Growth project is the only database and migration owner. The Product Service is an infrastructure boundary and is not linked from the Growth Console.

## Trust boundaries

The Public server authenticates with `LIVING_PULSE_PRODUCT_SERVICE_SECRET` using a Bearer credential. Growth compares it in constant time and fails closed when configuration or credentials are missing, malformed, or incorrect. It is unrelated to the operator secret/session, creator capability, and idempotency key.

Creator Results, lifecycle, and creator feedback still require the creator capability after service authentication. Public Pulse retrieval and response submission remain anonymous product operations. Product Service routes contain only explicit product use cases and do not compose acquisition or operator services.

## Public client and idempotency

The browser-facing API preserves its routes and response bodies. Its single typed client reads server-only `LIVING_PULSE_PRODUCT_SERVICE_URL` and `LIVING_PULSE_PRODUCT_SERVICE_SECRET`. The browser never receives either.

For a mutation, the Public function preserves a non-empty browser `Idempotency-Key` when supplied or creates one UUID for the logical call. The client reuses that exact key for both transport attempts. The Growth operation forwards it into the durable ledger. Reads are naturally retry-safe; lifecycle assignment is naturally replay-safe; all other retried mutations use the durable ledger.

## Timeout and retry policy

Each attempt has a 5-second abort timeout. The client makes at most two attempts (one retry). It retries network/timeout failures and 5xx Product Service responses for reads and retry-safe mutations. It does not retry 4xx validation, authorization, authentication, conflict, or not-found responses. There is no background or unbounded retry.

## Transactions

Each browser mutation maps to one Product Service operation. Pulse creation and its telemetry stay in one Growth-side database transaction. Response, written feedback/update opt-in, and response telemetry likewise stay in one transaction. No transaction is split across HTTP calls.

## Failure behavior

Product Service validation/application failures retain their existing sanitized statuses and messages. If configuration is invalid, the network times out, or both safe attempts fail, Public returns `503 { "error": "The request could not be completed." }`. It never fakes success, writes fallback state, or exposes the service URL, credentials, stack, database error, or route internals.

Logs contain only generic boundary failure messages. They exclude credentials, creator keys, idempotency keys, respondent emails, written feedback, payloads, and database details.

## Environment ownership

Growth/database owner:

- `LIVING_PULSE_PRODUCT_SERVICE_SECRET`
- `LIVING_PULSE_OPERATOR_SECRET`
- `RESEND_API_KEY` (future delivery only)
- `ACQUISITION_SENDING_ENABLED` (future)

Public:

- `LIVING_PULSE_PRODUCT_SERVICE_URL`
- `LIVING_PULSE_PRODUCT_SERVICE_SECRET`

Public must not receive operator, Resend, or acquisition-sending secrets. No server secret uses a `VITE_*` prefix.

## Cutover requirements

1. Keep the existing project as Growth/database owner and apply the already-created idempotency migration through its normal deploy lifecycle.
2. Configure the same newly generated Product Service secret on both server runtimes without exposing its value.
3. Configure Public's service URL to the Growth deploy-preview URL for verification, then the final Growth origin.
4. Confirm the new Public project has no Netlify Database binding and does not execute migrations.
5. Run end-to-end create, replay, response, Results, lifecycle, feedback, and telemetry checks before DNS cutover.
6. Configure custom domains only after temporary-domain verification.

## Rollback

DNS can remain on or return to the existing deployment while the new Public site is verified. The additive ledger migration is retained; it is compatible with the former single-site flow and must not be rolled back destructively. No data copy or reverse synchronization is required. If Product Service connectivity fails during cutover, stop Public traffic or revert routing rather than enabling Public database authority.
