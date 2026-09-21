# Living Pulse deployment isolation

> Database decision update: [docs/architecture/deployment-database-decision.md](./docs/architecture/deployment-database-decision.md) selects a Growth-owned database with a future authenticated server-to-server product boundary. Direct cross-site Netlify Database binding remains not verified.

This repository contains two explicit deployment compositions. Each Netlify project selects its composition with the supported Package directory setting. They share domain and database code, but they do not share frontend or function entrypoints.

Netlify searches for `netlify.toml` in Package directory, Base directory, then repository root order. The repository intentionally has no root `netlify.toml`, because root configuration would apply to both projects and override conflicting dashboard build fields.

## Runtime ownership

| Area | Public site | Growth site | Shared source |
| --- | --- | --- | --- |
| Frontend entry | `src/main.tsx` → `src/App.tsx` | `growth/main.tsx` → `src/GrowthConsole.tsx` | visual tokens in `src/index.css` |
| Function entry | `netlify/functions/api.mts` (Product Service client only) | `netlify/growth-functions/api.mts` (operator API + Product Service) | product/acquisition policies and contracts |
| Routes | landing, creation, publishing, public Pulse, Results | operator login/session/logout, console and acquisition operations | none registered across the boundary |
| Build output | `dist-public` | `dist-growth` | dependencies only |

The public React graph does not import `GrowthConsole`, and the public function does not import operator authentication, operator stores, acquisition console repositories, or acquisition mutation services. Public redirects explicitly reject `/growth`, `/growth/*`, and `/api/operator/*` before the SPA fallback.

## Public Netlify site

- Intended host: `pulse.livingitsolutions.com`
- Repository base directory: repository root
- Package directory: `deploy/public`
- Configuration: `deploy/public/netlify.toml`
- Build command: `npm run build:public`
- Publish directory: `dist-public`
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

Set each project's Package directory once in the Netlify UI. Netlify then selects the package-local configuration before considering Base or repository root. Do not copy build, publish, or functions values into dashboard fields; the selected repository configuration owns them.

## Database connectivity decision

The repository uses `drizzle-orm/netlify-db` with no connection string in source. The database binding is supplied by the existing Growth site's Netlify runtime. The Public function calls the authenticated Product Service and does not import the database repositories.

Netlify's default migration discovery is scoped to `base + package directory`. The Public package has no `netlify/database/migrations` directory and its configuration contains no explicit database migration path, so the root migrations are not discovered by Public. The Growth configuration explicitly sets `database.migrations.path = "netlify/database/migrations"`, retaining the existing migration owner and location. Public must also receive no database binding or database authority.

## Origin and cookie isolation

The Growth UI calls its API with same-origin `/api/operator/*` requests. Mutation validation requires the request `Origin` to equal the Growth request origin exactly. No CORS layer is needed.

The operator cookie has no `Domain` attribute, so it remains host-only to `growth.livingitsolutions.com`. It remains `HttpOnly`, `Secure` on HTTPS, `SameSite=Strict`, and restricted to `/api/operator`; it is not valid for `pulse.livingitsolutions.com`.

## Future product/acquisition relationship

Future validation reporting may need to connect a prospect and outreach attempt to the first attributed Pulse, publication, responses, and a later second Pulse. Existing powered-by attribution and product telemetry remain the source of product signals. This sprint adds no cross-site API, synchronization process, or speculative identifier. The data model and privacy boundary should be designed when that reporting requirement is defined.

## Deployment sequence

1. Keep the repository Base directory at the repository root for both projects.
2. Set the existing Growth project's Package directory to `deploy/growth`, then verify its resolved configuration before triggering a deploy.
3. Set the Public project's Package directory to `deploy/public`, then verify its resolved configuration before triggering a deploy.
4. Verify Growth exposes the operator API and authenticated Product Service and retains the existing database binding and migrations.
5. Do not enable Netlify Database or provide database authority to the Public project.
6. Configure only the dedicated Product Service server credential required by the Public function.
7. Verify Public deploy artifacts and functions contain no Growth entry or operator routes.
8. Assign the two custom domains and verify same-origin mutation behavior and host-only cookies.

No deployment, site creation, DNS change, database provisioning, or secret access is performed by this architecture change.
