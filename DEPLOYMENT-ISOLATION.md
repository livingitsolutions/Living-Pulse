# Living Pulse deployment isolation

> Database decision update: [docs/architecture/deployment-database-decision.md](./docs/architecture/deployment-database-decision.md) selects a Growth-owned database with a future authenticated server-to-server product boundary. Direct cross-site Netlify Database binding remains not verified.

This repository contains two explicit deployment compositions. Growth uses the repository root. Public uses a self-contained build base whose checked-in presentation/client source is synchronized from the root source with `npm run sync:public-site` and verified by `npm test`.

Netlify searches for `netlify.toml` in Package directory, Base directory, then repository root order. The repository intentionally has no root `netlify.toml`, because root configuration would apply to both projects and override conflicting dashboard build fields.

## Runtime ownership

| Area | Public site | Growth site | Shared source |
| --- | --- | --- | --- |
| Frontend entry | `deploy/public-site/src/main.tsx` → `App.tsx` | `growth/main.tsx` → `src/GrowthConsole.tsx` | Public copy is mechanically synchronized |
| Function entry | `deploy/public-site/netlify/functions/api.mts` (Product Service client only) | `netlify/growth-functions/api.mts` (operator API + Product Service) | product policies and contracts |
| Routes | landing, creation, publishing, public Pulse, Results | operator login/session/logout, console and acquisition operations | none registered across the boundary |
| Build output | `deploy/public-site/dist` | `dist-growth` | none |

The public React graph does not import `GrowthConsole`, and the public function does not import operator authentication, operator stores, acquisition console repositories, or acquisition mutation services. Public redirects explicitly reject `/growth`, `/growth/*`, and `/api/operator/*` before the SPA fallback.

## Public Netlify site

- Intended host: `pulse.livingitsolutions.com`
- Repository base directory: `deploy/public-site`
- Package directory: unset
- Configuration: `deploy/public-site/netlify.toml`
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`
- Operator/acquisition environment variables: none
- Database: no Netlify Database binding; product data is accessed through the Growth Product Service
- Migration ownership: no

The public site must not be configured with `LIVING_PULSE_OPERATOR_SECRET`, `ACQUISITION_SENDING_ENABLED`, or acquisition delivery credentials.

## Growth Netlify site

- Intended host: `growth.livingitsolutions.com`
- Repository base directory: repository root
- Package directory: `deploy/growth`
- Configuration: `deploy/growth/netlify.toml`
- Build command: `npm run build:growth`
- Publish directory: `dist-growth`
- Functions directory: `netlify/growth-functions`
- Required environment: server-only `LIVING_PULSE_OPERATOR_SECRET`
- Not required in this sprint: `RESEND_API_KEY`, `ACQUISITION_SENDING_ENABLED`
- Database: existing Living Pulse database binding; do not provision a second database
- Migration ownership: yes; this is the single intended migration owner

Growth keeps its existing Package directory. Public must use `deploy/public-site` as its Base directory and clear its old `deploy/public` Package directory so configuration and dependency installation occur entirely within the isolated subtree. Do not copy build, publish, or functions values into dashboard fields; the selected repository configuration owns them.

## Database connectivity decision

The repository uses `drizzle-orm/netlify-db` with no connection string in source. The database binding is supplied by the existing Growth site's Netlify runtime. The Public function calls the authenticated Product Service and does not import the database repositories.

The old Public package-directory setting selected its site configuration, but did not isolate Netlify Database discovery while the build base remained the repository root. A production Public deployment discovered the former root migration directory and provisioned a database. The shared root `@netlify/database` dependency was an independent provisioning trigger as well. Consequently, the old `deploy/public` layout is **not** a safe Public deployment boundary. The replacement `deploy/public-site` base excludes both triggers.

Netlify's documented structural boundary is the build base/dependency-management directory, not the package-directory setting alone. A supported repair requires a self-contained Public base (or a separate Public repository) whose dependency graph excludes `@netlify/database` and whose filesystem excludes database migrations. Growth owns the complete history at `deploy/growth/netlify/database/migrations`, selected by an explicit repository-root-relative configuration path. A repository-root compatibility symlink exposes that same directory at Netlify's conventional discovery path so deploy validation can still find the five immutable, already-applied versions; it is not a second migration history. No documented per-site switch disables Netlify Database provisioning or excludes conventional migrations.

## Origin and cookie isolation

The Growth UI calls its API with same-origin `/api/operator/*` requests. Mutation validation requires the request `Origin` to equal the Growth request origin exactly. No CORS layer is needed.

The operator cookie has no `Domain` attribute, so it remains host-only to `growth.livingitsolutions.com`. It remains `HttpOnly`, `Secure` on HTTPS, `SameSite=Strict`, and restricted to `/api/operator`; it is not valid for `pulse.livingitsolutions.com`.

## Future product/acquisition relationship

Future validation reporting may need to connect a prospect and outreach attempt to the first attributed Pulse, publication, responses, and a later second Pulse. Existing powered-by attribution and product telemetry remain the source of product signals. This sprint adds no cross-site API, synchronization process, or speculative identifier. The data model and privacy boundary should be designed when that reporting requirement is defined.

## Deployment sequence

1. Keep the existing Growth project's Base directory unset/root and Package directory set to `deploy/growth`.
2. Set the Public project's Base directory to `deploy/public-site` and clear its old Package directory value (`deploy/public`).
3. Verify Public resolves `deploy/public-site/netlify.toml`, installs only its local lockfile, and publishes `dist` before triggering any deploy.
4. Verify Growth exposes the operator API and authenticated Product Service and retains the existing database binding and migrations.
5. Do not enable Netlify Database or provide database authority to the Public project.
6. Configure only the dedicated Product Service server credential required by the Public function.
7. Verify Public deploy artifacts and functions contain no Growth entry or operator routes.
8. Assign the two custom domains and verify same-origin mutation behavior and host-only cookies.

No deployment, site creation, DNS change, database provisioning, or secret access is performed by this architecture change.
