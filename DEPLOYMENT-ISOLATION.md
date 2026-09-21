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
- Configuration: explicit `netlify.public.toml`
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
- Configuration: default `netlify.toml`
- Build command: `npm run build:growth`
- Publish directory: `dist-growth`
- Functions directory: `netlify/growth-functions`
- Required environment: server-only `LIVING_PULSE_OPERATOR_SECRET`
- Not required in this sprint: `RESEND_API_KEY`, `ACQUISITION_SENDING_ENABLED`
- Database: existing Living Pulse database binding; do not provision a second database
- Migration ownership: yes; this is the single intended migration owner

Netlify uses `netlify.toml` by default, so the existing database-owning project deploys Growth without dashboard build overrides. When creating the future Public site, configure it to use `netlify.public.toml`; do not point it at `netlify/growth-functions` or enable Netlify Database.

## Database connectivity decision

The repository uses `drizzle-orm/netlify-db` with no connection string in source. The database binding is supplied by the existing Growth site's Netlify runtime. The Public function calls the authenticated Product Service and does not import the database repositories.

Only the existing Growth project executes files under `netlify/database/migrations`. The future Public project must not have a Netlify Database binding or database authority, so it does not execute repository migrations. Selecting `netlify.public.toml` changes the Public build composition; keeping database integration disabled on that project enforces migration ownership at the platform boundary.

## Origin and cookie isolation

The Growth UI calls its API with same-origin `/api/operator/*` requests. Mutation validation requires the request `Origin` to equal the Growth request origin exactly. No CORS layer is needed.

The operator cookie has no `Domain` attribute, so it remains host-only to `growth.livingitsolutions.com`. It remains `HttpOnly`, `Secure` on HTTPS, `SameSite=Strict`, and restricted to `/api/operator`; it is not valid for `pulse.livingitsolutions.com`.

## Future product/acquisition relationship

Future validation reporting may need to connect a prospect and outreach attempt to the first attributed Pulse, publication, responses, and a later second Pulse. Existing powered-by attribution and product telemetry remain the source of product signals. This sprint adds no cross-site API, synchronization process, or speculative identifier. The data model and privacy boundary should be designed when that reporting requirement is defined.

## Deployment sequence

1. Deploy the existing database-owning project from the repository root with the default `netlify.toml` Growth settings.
2. Verify Growth deploy artifacts expose the operator API and authenticated Product Service and retain the existing database binding and migrations.
3. Create the future Public project from the repository root and explicitly select `netlify.public.toml` for its Netlify configuration.
4. Do not enable Netlify Database or provide database authority to the Public project.
5. Configure only the dedicated Product Service server credential required by the Public function.
6. Verify Public deploy artifacts and functions contain no Growth entry or operator routes.
7. Assign the two custom domains and verify same-origin mutation behavior and host-only cookies.

No deployment, site creation, DNS change, database provisioning, or secret access is performed by this architecture change.
