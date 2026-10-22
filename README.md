# Expense Tracker (private)

A self-hosted, single-user expense tracker that captures transactions automatically from bank
and card alerts, iPhone Shortcuts and statement imports. It reconciles them and reports capture
coverage honestly.

## Status

| Milestone | State |
|---|---|
| 0 Feasibility | Done. See the documents below |
| 1 Foundation | Done. Auth, PWA shell, Postgres + migrations, tests, CI and Docker files |
| 2–9 | Not started. Screens show "Not built yet" instead of sample figures |

Not verified yet: the Docker image has never been built (there's no Docker on the dev machine,
see ADR-0002). Its first build happens in GitHub Actions or on the VPS.

## Local development (Windows, no Docker)

Requirements: Node.js 24+ and Git. Commands below are for PowerShell; use `npm.cmd` if
`npm` is blocked by execution policy.

```powershell
npm.cmd install
Copy-Item .env.example .env.local     # first time only

# Terminal 1: local PostgreSQL 18 (data in .data/postgres, port 5433)
npm.cmd run db:start

# Terminal 2
npm.cmd run db:migrate
npm.cmd run user:create -- you@example.com   # prompts for a password (min 12 chars)
npm.cmd run dev                               # http://localhost:3000
```

### Tests

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test              # unit + integration, against a throwaway real Postgres
npx.cmd playwright install chromium   # first time only
npm.cmd run test:e2e      # production build + browser tests at desktop and mobile sizes
```

None of these need the dev database running. Each starts its own temporary one.

### Database changes

Edit `src/server/db/schema.ts`, run `npm.cmd run db:generate`, review the SQL in `drizzle/`,
then run `npm.cmd run db:migrate`.

### Password recovery

There's no reset link on the website. On the server:

```sh
docker compose run --rm web npm run user:reset-password -- you@example.com
```

This signs out every existing session.

## Deployment (outline, full guide in Milestone 9)

On the VPS: copy `deploy/.env.production.example` to `.env`, fill it in, then run
`docker compose up -d --build`. Caddy obtains HTTPS certificates automatically once DNS points
at the server. Create the user with
`docker compose run --rm web npm run user:create -- you@example.com`.

## Project layout

```
src/app/            Next.js routes (login, (app) private pages, api/health, PWA manifest/icons)
src/server/         Server-only code: env, db (schema, client, migrations), auth, audit, logger
src/proxy.ts        Early redirect for requests without a session cookie
scripts/            Dev database, migrations, user CLI, E2E server
drizzle/            SQL migrations (checked in)
tests/              unit, integration (real Postgres), e2e (Playwright)
deploy/             Caddyfile and production env template
docs/               Feasibility report, ADRs, plan
```

## Documents

- [Capture feasibility report](docs/capture-feasibility.md): what can and can't be captured on iPhone, Gmail and statements
- [Implementation plan and risk register](docs/implementation-plan.md)
- [Environment report](docs/milestone-0/environment-report.md)
- Architecture decisions: [docs/adr/](docs/adr/)
