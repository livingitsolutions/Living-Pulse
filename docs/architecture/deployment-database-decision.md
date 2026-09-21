# Deployment database architecture decision

Date: 2026-09-21

Status: Decision ready; implementation not started

## Decision

Use the existing Netlify project as the Growth and database-owning project. The future Public project must not receive a direct Netlify Database binding unless Netlify later documents and confirms cross-site attachment. Instead, implement a narrowly scoped, authenticated server-to-server product service on the existing database-owning project and make the Public site's server functions its only caller.

This is Option B: Growth-owned database plus a Public service boundary.

The decision keeps existing data in place, uses one migration owner, avoids an undocumented shared binding, preserves operator and delivery secret isolation, and retains a single relational database for future product/acquisition attribution. It requires a separate implementation sprint before the Public project can be created.

## Current repository state

### Database access model

- Runtime ORM: `drizzle-orm` beta.
- Netlify adapter: `drizzle-orm/netlify-db` in `db/index.ts`.
- Initialization: `drizzle({ schema })`; no connection argument is supplied.
- Schema: `db/schema.ts`.
- Drizzle Kit: `drizzle.config.ts`, PostgreSQL dialect.
- Migration output: `deploy/growth/netlify/database/migrations`, explicitly selected only by `deploy/growth/netlify.toml` using a repository-root-relative path. The conventional root path is a compatibility symlink to this directory for applied-migration validation.
- Database package: `@netlify/database` is installed, but application code does not directly call `getDatabase` or `getConnectionString`.
- Explicit connection environment: no `DATABASE_URL`, PostgreSQL URL, or other connection string is referenced in repository code or configuration.
- Other clients: none. There is no `pg`, external ORM, or separately initialized database client.
- Binding ownership: connection information is supplied automatically by the Netlify runtime through the Netlify Database adapter.

Netlify automatically applies discovered migrations immediately before production publication and for deploy previews. Production deploys use the main database; deploy previews receive database branches. Each project now selects a package-local `netlify.toml`; default migration discovery is package-scoped, and only Growth explicitly points to the root migration directory.

### Database consumers

| Consumer | Classification | Operations |
| --- | --- | --- |
| `netlify/functions/api.mts` | PUBLIC PRODUCT | Pulses, responses/update opt-ins, Results, feedback, lifecycle, events/telemetry |
| `db/operatorStore.ts` | GROWTH | Operator sessions and login-attempt limits |
| `db/acquisitionConsole.ts` | GROWTH | Prospect, attempt, and suppression read models |
| `db/prospectStore.ts` | GROWTH | Transactional prospect, suppression, attempt, and audit persistence |
| `db/acquisitionApplication.ts` | GROWTH / shared application composition | Binds shared acquisition services to the database repository |
| `netlify/growth-functions/api.mts` | GROWTH | Composes operator and acquisition consumers |
| `scripts/import-prospects.ts` | GROWTH / internal operation | Uses acquisition validation and persistence for explicit internal intake |
| `db/index.ts` and `db/schema.ts` | SHARED | One adapter and schema used by both compositions |
| `drizzle.config.ts`, `deploy/growth/netlify/database/migrations/*`, and `deploy/growth/netlify.toml` | MIGRATION / DEPLOYMENT | Schema generation and Growth-only platform-applied migrations |

Pure domain modules and their tests do not instantiate or query a database.

## Data ownership map

### Public product data

- `pulses`: Pulse definition, creator capability, lifecycle/status, update-opt-in configuration.
- `responses`: answers, written follow-up feedback, and optional respondent update-opt-in email.
- `events`: creator/product telemetry and powered-by attribution metadata. `pulse_id` is a logical identifier without a database foreign key.
- `feedback`: creator validation feedback linked to a Pulse.
- `counters`: legacy/other product table; currently no runtime consumer was found.

### Acquisition / Growth data

- `acquisition_prospects`
- `acquisition_suppressions`
- `acquisition_outreach_attempts`
- `acquisition_audit_events`

### Operator data

- `operator_sessions`
- `operator_login_attempts`

### Relational dependencies

- `responses.pulse_id` → `pulses.id` with cascade delete.
- `feedback.pulse_id` → `pulses.id` with cascade delete.
- `acquisition_outreach_attempts.prospect_id` → `acquisition_prospects.id` with cascade delete.
- `acquisition_audit_events.prospect_id` → `acquisition_prospects.id` with set-null delete.
- `acquisition_audit_events.attempt_id` → `acquisition_outreach_attempts.id` with set-null delete.
- Suppressions relate to prospects by normalized email in application/query logic, not by foreign key.
- Operator tables have no foreign keys.

Acquisition and operator tables do not reference `pulses`, `responses`, `events`, `feedback`, or other product rows at the database level. Product/acquisition attribution is not yet a relational database relationship.

## Verified Netlify constraints

Evidence reviewed:

- [Netlify Database overview](https://docs.netlify.com/build/data-and-storage/netlify-database/): describes a fully managed database, production main database, deploy-preview branches, and platform-managed migrations.
- [Getting started](https://docs.netlify.com/build/data-and-storage/netlify-database/getting-started/): describes adding/provisioning a database for a project/site and automatic provisioning on deploy.
- [Migrations](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/): documents automatic migration application from a configured migration directory during each site's deploy lifecycle and optional manual migration management.
- [API reference](https://docs.netlify.com/build/data-and-storage/netlify-database/api/): documents `getConnectionString`, an optional `connectionString` for `getDatabase`, and REST endpoints scoped as `/sites/{site_id}/database`.

The documentation proves that:

- Netlify Database management and REST endpoints are site-scoped.
- A site can retrieve its environment-specific PostgreSQL connection string.
- `@netlify/database` can accept an explicit PostgreSQL connection string.
- Migration and preview-branch behavior is integrated with a site's deploy lifecycle.

The reviewed documentation does **not** document:

- attaching one existing Netlify Database binding to a second site;
- sharing the automatic binding across sites;
- referencing another site's database as a first-class Netlify Database attachment;
- coordinating deploy-preview branch selection across two sites;
- assigning automatic migration ownership to one site while a second site uses the same automatic binding.

Classification: **SHARED NETLIFY DATABASE ACROSS TWO SITES: NOT VERIFIED**.

The connection-string primitives make explicit PostgreSQL access technically plausible, but the reviewed documentation does not establish cross-site Netlify Database use as a supported lifecycle architecture. Connection lifetime/rotation, branch mapping, pooling, and migration behavior must not be guessed.

## Options evaluated

### Option A — two sites directly share the existing Netlify Database

- Security: clean application/function separation if the binding were officially supported; both runtimes would nevertheless hold direct database authority.
- Complexity: lowest code change, but unsupported configuration would create hidden operational risk.
- Migrations: automatic deploy coupling could cause two owners/races; no documented independent ownership control was found.
- Data/latency: no duplication and direct low-latency queries.
- Existing data, Results, responses: preserved in place.
- Attribution: direct within one database.
- Automation/secrets: Resend and operator secrets can remain Growth-only; database authority would be shared.
- Rollback: application rollback is simple, database lifecycle rollback is ambiguous across sites.
- Decision: not selectable because platform support is **NOT VERIFIED**.

### Option B — existing Growth site owns DB; Public uses a product service boundary

- Security: Public has no database credential and no acquisition/operator authority. Growth/database-owning runtime exposes only an authenticated product-service contract to the Public server.
- Trust direction: Public server → database-owning product service. Browser traffic calls the Public site's same-origin API and must never call the internal service directly.
- Allowed operations: Pulse create/read, response submission, creator-authorized Results, lifecycle changes, feedback, update opt-in, and product telemetry. Acquisition/operator operations are excluded.
- Authentication: requires a future dedicated server-to-server mechanism with rotation and least privilege. It must not reuse the operator secret, creator capability, URL query credentials, or browser storage. No credential is selected or created in this sprint.
- Complexity: moderate/high. Current public handlers must be extracted behind a service contract or proxy client, with careful preservation of status codes, creator capability checks, and telemetry.
- Migrations: exactly one owner—the existing Growth/database-owning project.
- Data/latency: no duplication; one additional same-region/server request per operation. Timeouts and Growth-site availability become public-product dependencies.
- Existing data, Results, responses: remain in place; old creator links can continue resolving once the Public server forwards requests correctly.
- Attribution: direct because product and acquisition data stay in one database.
- Automation/secrets: Resend, sending flag, and operator secret remain Growth-only. The Public site receives only the future product-service credential.
- Failure implications: service outage blocks Pulse creation, responses, Results, lifecycle changes, and telemetry; public functions need bounded timeouts and generic failures.
- Rollback: route traffic can return to the existing project without data movement.
- Decision: **recommended** as the safest architecture supported by ordinary Netlify Functions/HTTPS boundaries without assuming cross-site database binding.

### Option C — Growth keeps acquisition/operator DB; Public receives a product DB

- Security: strongest database separation and secret isolation.
- Complexity: highest near-term data work. The unified schema/migration history would need deliberate separation.
- Migrations: each database needs one owner and separate migration streams.
- Data: existing product rows must be copied or moved safely; prohibited in this sprint.
- Existing data, Results, responses: high risk. Creator links and Pulse IDs must remain stable; cutover must prevent lost or split responses.
- Attribution: possible only through an explicit cross-database integration/event model; unnecessarily difficult now.
- Latency: direct within each site after migration.
- Automation: Growth-only Resend remains straightforward.
- Rollback: difficult after writes begin in the new product database because data reconvergence is required.
- Decision: not recommended for validation-stage scale or current data-safety requirements.

### Option D — explicitly addressable PostgreSQL shared by both sites

- Evidence: Netlify documents retrieving a site connection string and `@netlify/database` accepting an explicit connection string. It does not document the full two-site lifecycle as a supported Netlify Database topology.
- Security: both sites require server-only database credentials; Public necessarily gains broad database network access unless database roles/schema privileges are introduced.
- Complexity: moderate to high. The current `drizzle-orm/netlify-db` initialization has no explicit connection input. The exact adapter configuration must be verified; it may require changing to a supported driver initialized from `@netlify/database` or another pooled serverless PostgreSQL driver.
- Pooling: serverless-safe pooling/connector behavior must be retained. A raw long-lived `pg.Pool` should not be introduced without platform guidance.
- Migrations: exactly one owner, preferably the existing database-owning Growth project or an out-of-band migration job; Public must never auto-apply.
- Data/latency: no duplication and direct queries.
- Existing data, Results, responses: preserved if the connection targets the same database.
- Preview safety: an explicit production URL could cause Public deploy previews to write production data, losing Netlify's automatic branch isolation.
- Attribution: direct in one database.
- Automation/secrets: operator and Resend secrets stay Growth-only; a database credential must exist on both sites.
- Rollback/migration risk: adapter and credential cutover create meaningful risk but no data move is inherently required.
- Decision: viable contingency only after Netlify confirms supported cross-site connection, credential lifecycle, preview branching, and adapter/pooling guidance.

### Option E — keep one Netlify deployment

- Security: avoids cross-site database authority but reverses the runtime isolation objective; private routes coexist with the public runtime.
- Complexity/migrations/data: lowest; one owner and no movement.
- Results/responses/attribution: direct and unchanged.
- Automation/secrets: the single site holds operator and future Resend authority.
- Rollback: simplest.
- Decision: operational fallback, not recommended because it gives up the explicit public/private deployment boundary established in Sprint -1A.9.1.

## Preferred existing-project-as-Growth topology

The existing project keeps its database and becomes `growth.livingitsolutions.com`. It remains the sole migration owner and holds operator, future Resend, and acquisition-sending secrets.

Before the new Public project can serve traffic, the database-owning project needs the product service described in Option B. The new Public site's server functions must forward:

- Pulse creation and public Pulse reads;
- response submission and update opt-in;
- creator-authorized Results retrieval;
- lifecycle changes and creator feedback;
- product telemetry and attribution events.

The service must preserve current validation, creator capability checks, transactional behavior, response shapes, and generic error handling. The Public browser remains same-origin with the Public site; only Public server functions communicate with Growth's product service. Existing data is not copied.

## Reverse existing-project-as-Public topology

Keeping the existing project as Public would preserve direct product database access and minimize risk to Pulse creation, responses, and creator Results. A new Growth project would still need acquisition/operator database access.

Providing that access through an explicit service on the Public site would place acquisition-control server routes and database mediation back into the public runtime, contrary to the required public-runtime invariant. Direct Growth database access returns to unverified Option A/D. Operationally, the reverse topology is easier for product continuity but weaker for the required runtime separation and future Growth-only automation ownership. It is not recommended under the current constraints.

## Product/acquisition attribution

Option A and D make the eventual relationship direct in one database. Option B also keeps it direct because the database remains unified; only product operations cross a server boundary. Option C requires explicit cross-database integration and is unnecessarily difficult. Option E remains direct but loses deployment isolation.

No attribution relationship is implemented. Existing powered-by attribution and telemetry remain unchanged.

## Production data safety

**PRODUCTION DATA CONTENTS: NOT INSPECTED.**

No production query was run. The existing database is treated as containing product and validation data that must survive. No destructive migration, schema edit, copy, move, export, or connection access is authorized by this decision.

## Migration ownership

Required invariant: exactly one deployment owns migrations.

- Recommended Option B: existing Growth/database-owning project.
- Option A, if ever verified: one explicitly designated site only; automatic behavior must be proven controllable first.
- Option C: Public owns product migrations; Growth owns acquisition/operator migrations after a deliberate schema split.
- Option D: existing Growth project or one out-of-band migration process; never both application sites.
- Option E: the single site.

## Secret ownership

Growth may own `LIVING_PULSE_OPERATOR_SECRET`, future `RESEND_API_KEY`, and future `ACQUISITION_SENDING_ENABLED`. Public must not receive them.

Under Option B, Public eventually needs only a dedicated server-to-server product-service credential. Under Option D, both sites additionally need server-only database connectivity; no database credential may use `VITE_*` or enter client bundles.

## Build boundaries

The Sprint -1A.9.1 build boundaries remain correct under all options:

- Public: `npm run build:public`, `dist-public`, `netlify/functions`.
- Growth: `npm run build:growth`, `dist-growth`, `netlify/growth-functions`.

Option B requires later changing the Public function's persistence implementation from direct repository access to the product-service client. It does not require undoing frontend or function-directory isolation.

## Deployment prerequisites

1. Design and security-review the narrow product-service contract for Option B.
2. Select a dedicated server-to-server authentication mechanism and rotation procedure; do not reuse existing secrets or capabilities.
3. Extract current product API behavior behind that service without changing public response contracts.
4. Add timeouts, error mapping, observability without sensitive payloads, and rollback routing.
5. Prove Pulse creation, public reads, responses, update opt-in, Results, lifecycle, feedback, events, and creator capability behavior end-to-end.
6. Verify the existing project remains the only migration owner.
7. Only then create/configure the new Public project and move domains.

Optional platform follow-up: ask Netlify whether cross-site attachment of one Netlify Database is officially supported, how deploy-preview branches map across sites, and how automatic migration ownership can be disabled per consumer site. A positive documented answer could reopen Option A or D, but it is not required to proceed with Option B.

## Unresolved implementation questions

- Exact product-service authentication and credential rotation mechanism.
- Whether the internal service should use a dedicated hostname/path inaccessible from browser workflows or a normal HTTPS function path protected by server authentication.
- Timeout, retry, and idempotency policy for response submission and event ingestion.
- Deployment ordering and rollback routing during the domain cutover.
- Whether Netlify can officially support Option A/D with preview-branch safety; current classification remains NOT VERIFIED.

## Decision gate

**DECISION READY**

The selected Option B does not depend on unverified shared-database functionality. Implementation and deployment require a separate authorized sprint.
