# PostgreSQL migration ownership

The directories under `deploy/growth/netlify/database/migrations` are Living Pulse's authoritative ordered migration history. The timestamp-prefixed directory name and exact `migration.sql` bytes are immutable after application. `snapshot.json` is generation metadata and is never executed.

The administrative runner records each migration in `living_pulse_migrations.migration_history`, including its version, name, SHA-256 checksum, sequence, and application time. The ledger must be an exact prefix of disk history. Unknown, missing, changed, duplicate, gapped, or out-of-order history fails closed and is never repaired automatically.

Use `npm run db:migrate:status` to inspect state and `npm run db:migrate:apply` to apply pending migrations. Both require a server-side `DATABASE_URL` and `DB_MIGRATION_TARGET`. A production apply additionally requires:

```text
DB_MIGRATION_TARGET=production
DB_MIGRATION_CONFIRM=APPLY_LIVING_PULSE_PRODUCTION_MIGRATIONS
```

Each command holds one session-level PostgreSQL advisory lock. Each pending migration and its ledger insert run in one transaction; failure rolls back that migration, records nothing, and stops the run. The runner releases its lock in a `finally` path.

Use a dedicated DDL-capable migration credential and a separate least-privileged runtime credential. Never expose either to browser code or logs. Apply is an explicit administrative action only: do not invoke it from builds, deploy hooks, Function imports, HTTP requests, application startup, or normal runtime traffic.
