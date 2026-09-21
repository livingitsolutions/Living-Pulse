# Living Pulse deployment isolation

> Database decision update: [docs/architecture/deployment-database-decision.md](./docs/architecture/deployment-database-decision.md) selects a Growth-owned database with a future authenticated server-to-server product boundary. Direct cross-site Netlify Database binding remains not verified.

This repository contains two explicit deployment compositions. They share domain and database code, but they do not share frontend or function entrypoints.

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
- Configuration: default `netlify.toml`
- Build command: `npm run build:public`
- Publish directory: `dist-public`
- Functions directory: `netlify/functions`
- Operator/acquisition environment variables: none
- Database: existing Living Pulse database binding for product data
- Migration ownership: yes; this is the single intended migration owner

The public site must not be configured with `LIVING_PULSE_OPERATOR_SECRET`, `ACQUISITION_SENDING_ENABLED`, or acquisition delivery credentials.

## Growth Netlify site

- Intended host: `growth.livingitsolutions.com`
- Repository base directory: repository root
- Reference configuration: `netlify.growth.toml`
- Build command: `npm run build:growth`
- Publish directory: `dist-growth`
- Functions directory: `netlify/growth-functions`
- Required environment: server-only `LIVING_PULSE_OPERATOR_SECRET`
- Not required in this sprint: `RESEND_API_KEY`, `ACQUISITION_SENDING_ENABLED`
- Database: must connect to the same existing Living Pulse database; do not provision a second database
- Migration ownership: no

Netlify uses `netlify.toml` by default. When creating the future Growth site, configure the Growth build command, publish directory, and functions directory explicitly in that site's settings using `netlify.growth.toml` as the checked-in blueprint. Do not point the Growth site at `netlify/functions`.

## Database connectivity decision

The repository uses `drizzle-orm/netlify-db` with no connection string in source. The database binding is supplied by the Netlify site runtime. Repository inspection therefore cannot prove that a second Netlify site can attach to the first site's managed database, nor can it prove how migration discovery is disabled for only the second site.

Before creating the Growth site, confirm with the current Netlify Database capabilities that the same managed database can be attached to both sites using a supported team-level or explicit binding. Do not copy a credential from logs, create another database, or assume the automatic per-site binding is shared. If shared attachment is unavailable, stop and choose a supported single-database architecture before deployment.

Only the public site should execute files under `netlify/database/migrations`. The Growth site must have migration execution disabled or excluded through a Netlify-supported site setting while retaining runtime access to the same database. This is a deployment prerequisite, not an application schema change.

## Origin and cookie isolation

The Growth UI calls its API with same-origin `/api/operator/*` requests. Mutation validation requires the request `Origin` to equal the Growth request origin exactly. No CORS layer is needed.

The operator cookie has no `Domain` attribute, so it remains host-only to `growth.livingitsolutions.com`. It remains `HttpOnly`, `Secure` on HTTPS, `SameSite=Strict`, and restricted to `/api/operator`; it is not valid for `pulse.livingitsolutions.com`.

## Future product/acquisition relationship

Future validation reporting may need to connect a prospect and outreach attempt to the first attributed Pulse, publication, responses, and a later second Pulse. Existing powered-by attribution and product telemetry remain the source of product signals. This sprint adds no cross-site API, synchronization process, or speculative identifier. The data model and privacy boundary should be designed when that reporting requirement is defined.

## Deployment sequence

1. Confirm supported cross-site attachment to the existing database and a supported way to make the public site the only migration owner.
2. Create the public site from the repository root using the public settings above and attach the existing product database.
3. Verify public deploy artifacts and functions contain no Growth entry or operator routes.
4. Create the Growth site from the same repository root using the Growth settings above.
5. Attach the same database without provisioning another database or enabling migrations.
6. Configure only the server-side operator secret on the Growth site.
7. Assign the two custom domains and verify same-origin mutation behavior and host-only cookies.

No deployment, site creation, DNS change, database provisioning, or secret access is performed by this architecture change.
