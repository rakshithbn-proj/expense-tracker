# Handoff: private expense tracker

Read this first in a new chat. The original requirements are the user's "Master Build Prompt"
(20 sections, milestones 0–9). If the new chat doesn't have it, ask the user to paste it; this
file summarises what matters from it.

**The app runs on the user's VPS since 2026-10-27** (Milestone 9; see
[Running on the VPS](#running-on-the-vps)). The PC copy is stopped. Still to do: Google redirect
URIs, iPhone Shortcut URLs, PWA reinstall and checks on mobile data (`docs/server-transition.md`).

## What this is

A private, single-user expense tracker for one user in India (INR). It captures transactions
automatically wherever possible (Gmail bank alerts, iPhone Shortcuts, later statement imports),
applies strict accounting rules, and reports capture coverage honestly. It's a mobile-first PWA,
self-hosted on a VPS with Docker Compose. Core principle from the spec: **never claim an
integration works until it's tested with real evidence; never fake or simulate capture.**

- Repo: `D:\Rakshith\expense_tracker`, GitHub `rakshithbn-proj/expense-tracker` (**public**), branch `main`.
- Stack: Next.js 16 (App Router, Cache Components **off**), TypeScript strict, PostgreSQL 18 +
  Drizzle, Vitest, Playwright, Tailwind 4. No chart library (hand-built SVG). Details: `docs/adr/`.

## Git state

- Everything is committed and **pushed** (2026-10-27). Last commit: `0278885` (Explain payments
  + Why filter). Local `main` = `origin/main`.
- The user reviewed and approved what is in the public repo, including the redacted email
  fixtures. Still **ask before pushing** new personal-looking data (fixtures, samples).
- Check CI after a push: `gh run list --limit 3` / `gh run watch`. CI also builds the Docker
  image and validates `compose.yaml` (`.github/workflows/ci.yml`, job `docker`).
- Commit straight to `main` (the user's established workflow). Commit trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Milestones

| # | Status | Notes |
|---|---|---|
| 0 Feasibility | Done | `docs/capture-feasibility.md` (updated with real evidence in §6a) |
| 1 Foundation | Done | Auth (argon2id, DB sessions, rate limit), PWA shell, migrations, CI, Docker files |
| 2 Data model | Done | Accounting rules in `src/server/finance/accounting.ts` (ADR-0006) |
| 3 Dashboard/reports | Done | Overview, explorer, 14 reports, budgets, settings |
| 4 Gmail | Built and tested; **partly validated live** | Real HSBC alerts captured. HDFC, ICICI and RBL await live alerts |
| 5 iPhone | Server side done; **Quick Add and Explain payments work from the user's iPhone** | ICICI bank-account UPI debits parsed from SMS. SMS automation reliability and share-receipt not confirmed |
| 6 Statements | **Deferred by the user** (2026-10-26) | Don't start unless asked |
| 7 Sheets + notifications | **Done; Sheets tested live** | ADR-0008, `docs/setup/sheets.md` |
| 8 Security/backups | **Deferred by the user** (2026-10-26) | Backups (restic → B2/R2) become important once on the VPS; raise it after the move |
| 9 Deploy + 30-day evaluation | **Deployed 2026-10-27**; Shortcuts/PWA switch and 30-day evaluation pending | See [Running on the VPS](#running-on-the-vps) |

Tests: 301 unit/integration (Vitest, real embedded Postgres), all passing at `0278885`; lint and
typecheck clean. E2E (Playwright) includes `tests/e2e/explain.spec.ts`; run `npm.cmd run test:e2e`
before deploying.

## Live integrations and the user's setup (no secrets here)

- **Gmail:** connected through the user's own Google Cloud project (published "In production",
  `gmail.readonly`). The account that receives bank alerts **auto-forwards** them to the account
  connected to the app. Forwarded alerts pass the sender check via Gmail's ARC result.
- **Sender verification:** an alert becomes a transaction only if Gmail's topmost
  `Authentication-Results` shows a DKIM (or ARC) pass for the bank's own domain
  (`src/server/ingestion/email/authentication.ts`). Senders use the new `.bank.in` domains.
- **Banks in scope:** HDFC, HSBC, ICICI, RBL. **SBI and AMEX are excluded at the user's request.**
- **User requirement: ignore OTP emails and SMS completely** (`isOtpMessage` in `parse-helpers.ts`).
- **Google Sheets:** connected to an account the user chose in Settings (not vikkirak@gmail.com).
- **iPhone Shortcuts** (all use one device key, header `Authorization: Bearer etk_…`), all pointing
  at the PC address today:
  - Quick Add → `…/api/ingest/shortcut?format=text`
  - SMS forwarding automation → `…/api/ingest/shortcut`
  - **Explain payments** (built by the user 2026-10-27, works): GET `…/api/ingest/explain`
    (`?manual=1` in the by-hand copy), then for each item asks category (list from the server)
    and **"Why?" from a fixed list in the Shortcut**: Rakshith Personal, Shared Rental Expense,
    Nagabhushan, Home Expense, Mruthula Expense. POST `…/api/ingest/explain?format=text`.
    The reason is free text on the server; **Transactions → Filters → Why** lists the distinct
    reasons used. The label shows amount · payee · method (UPI/Card…) · account · time.
    Guide: `docs/setup/explain-shortcut.md`.
- **PC network (temporary until the move):** the PC was given a manual Wi-Fi IP. It was
  mistyped once (`19.168.0.2`, mask /32), which made every Shortcut time out. Correct is
  `192.168.0.2`, mask `255.255.255.0`, gateway `192.168.0.1` (or DHCP + router reservation).
  Sometimes the PC sits on the iPhone hotspot instead (`172.20.10.x`). If Shortcuts time out,
  check `ipconfig` and which network each device is on before touching code. All of this goes
  away on the VPS.

## Moving to the VPS

The checklist is **`docs/server-transition.md`** (data and secrets, Google console, every
Shortcut URL, PWA, services, verification). Keep it updated; tick items as they're done.

What already exists:

- `compose.yaml`: `db` (postgres:18, not published), `migrate` (runs once), `web`, `worker`
  (Gmail sync + queues + Sheets + notifications), `caddy` (ports 80/443, automatic HTTPS).
- `Dockerfile` (multi-stage, node 24, built on the VPS; `tsx` is a runtime dependency so the
  worker and `db:migrate` run in the image). `deploy/Caddyfile`. `deploy/.env.production.example`
  → copy to `.env` next to `compose.yaml`, `chmod 600`.
- The image has been built in CI but **never run**. Expect first-run issues; check
  `docker compose logs web worker migrate`.

Ask the user for (don't guess): VPS provider, OS, IP, SSH access, the **domain/subdomain** and
where its DNS is managed, and whether Docker is installed. Then, roughly:

1. VPS: install Docker + compose plugin, firewall allows 22/80/443 only, clone the repo.
2. DNS A record for the domain → VPS IP (Caddy needs it for the certificate).
3. `.env` on the VPS: `DOMAIN`, a new `POSTGRES_PASSWORD`, and **the same**
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` as the PC's `.env.local`
   (same key = Gmail and Sheets tokens keep working). The user copies them across themselves;
   never print them.
4. Google Cloud console: add `https://DOMAIN/api/gmail/callback` and
   `https://DOMAIN/api/sheets/callback` as redirect URIs.
5. **Copy the database.** The PC has **no `pg_dump`** (the embedded PostgreSQL ships only the
   server binaries). Options: install the PostgreSQL 18 command-line tools on Windows (EDB zip
   binaries; no service needed), then
   `pg_dump -h localhost -p 5433 -U postgres -Fc expense_tracker -f expense.dump`
   with `npm.cmd run app:start` running; or run `pg_dump` from a `postgres:18` container on
   the VPS through an SSH tunnel to the PC. Restore on the VPS: start `db` only,
   `docker compose cp` the dump in, `pg_restore --clean --if-exists --no-owner -U expense
   -d expense_tracker`, then `docker compose up -d`. Migrations are idempotent and run after.
   If the user would rather start fresh: `docker compose run --rm web npm run user:create`,
   then reconnect Gmail and Sheets, and create a new device key.
6. `docker compose up -d --build`; check `docker compose ps`, `https://DOMAIN/api/health`.
7. **Stop the PC's worker** (`npm.cmd run app:stop`) so two workers don't poll Gmail.
8. User updates every Shortcut URL to `https://DOMAIN/...` (list in `server-transition.md` §3),
   re-adds the PWA from the new address, and tests **on mobile data**.
9. Then: backups (M8) and the 30-day capture evaluation.

## Running on the VPS

The steps above were done on 2026-10-27. The server's address, domain and SSH key are in the
user's `~/.ssh/config` and Claude's memory, not in this public repo.

- The VPS already runs other apps from `/root/docker-compose.yml` behind **Traefik** (owns
  80/443, network `root_default`, certresolver `mytlschallenge`). **Don't edit that file.** This
  app is its own compose project in `/root/expense-tracker` (git clone of `main`); `.env` there
  sets `COMPOSE_FILE=compose.yaml:deploy/compose.traefik.yaml`, so plain `docker compose …`
  includes the Traefik labels and leaves Caddy off.
- Update: `cd /root/expense-tracker && git pull && docker compose up -d --build` (migrations run
  first automatically). Logs: `docker compose logs -f web worker`.
- DB shell: `docker compose exec db psql -U expense -d expense_tracker`. The copy made at the
  move is in `/root/expense-tracker-backups/` (chmod 700); no regular backups yet (M8).
- How the DB was copied: `ssh -R 127.0.0.1:15433:127.0.0.1:5433` from the PC, then
  `pg_dump` in a `postgres:18 --network host` container on the VPS. Reusable if needed.
- The PC's `npm.cmd run app:start` still works for development, but **don't run the worker on
  the PC** while the server is live (both would poll Gmail).

## Running locally (Windows, no Docker)

```powershell
npm.cmd run app:start    # DB (pg_ctl, port 5433) → migrations → next dev :3000 → worker, all in the background
npm.cmd run app:stop     # stops worker and web, then a CLEAN PostgreSQL shutdown
npm.cmd run app:status
npm.cmd run check        # lint + typecheck + unit/integration
npm.cmd run test:e2e     # build + Playwright (own throwaway DB on 5435, port 3100)
```

- Local login: `dev@example.com` / `dev-password-1234` (dev database only). Sample data:
  `npm run db:seed:sample [-- --remove]`.
- Logs: `.data/logs/` (`web.log` shows each request; handy to see whether the phone reached
  the server). Local DB data: `.data/postgres/`. Email samples (private, git-ignored): `.data/email-samples/`.
- Secrets live in `.env.local` (git-ignored). Never print them.
- Quick DB look without psql: `node --env-file=.env.local -e "…require('pg')…"`, or a tsx script
  run with `npx tsx --conditions=react-server --env-file=.env.local <file>` (wrap top-level
  `await` in an async IIFE; tsx compiles to CJS here).

## Environment gotchas (learned the hard way)

- **Read `node_modules/next/dist/docs/` before Next.js work** (`AGENTS.md`): v16 differs from
  older versions (e.g. `proxy.ts` instead of middleware, `PageProps`/`RouteContext` helpers).
- **Line endings:** the repo is LF. Python on Windows writes CRLF in text mode; use
  `newline=''` or run `sed -i 's/\r$//'` afterwards (`git ls-files --eol` to check). Prefer the
  Write/Edit tools for code edits.
- **PostgreSQL on Windows:** embedded-postgres's `stop()` force-kills; use
  `scripts/lib/local-pg.ts` (`pg_ctl`). Test DBs call `removeOrphanedPostgresHelpers()` first.
- **Endless page reloads in dev**: `next.config.ts` sets `turbopackFileSystemCacheForDev: false`.
  If it recurs: `app:stop`, delete `.next/dev`, `app:start`.
- `next dev` reloads code changes itself; no restart needed after edits.
- The E2E server deliberately blanks the Google env vars.
- Tests with a fixed clock must pass `now` into queue/explain functions; never rely on `now()`.
- PowerShell 5.1: use `npm.cmd`/`npx.cmd`; no `&&`.

## Code map

- `src/server/finance/`: accounting, analytics, matching, rules, and the services for
  transactions (incl. filters and `listReasons`), budgets, reports and categories.
- `src/server/ingestion/`: `email/`, `gmail/`, `shortcut/` (device keys, submissions), `ingest.ts`,
  `queue.ts` (durable `FOR UPDATE SKIP LOCKED` queue), `health.ts`, `mask.ts`.
- `src/server/explain/service.ts`: explain prompts (schedule, lease/retry, labels, answering). ADR-0009.
- `src/server/capture/capabilities.ts`: the spec §4.2 capability matrix and statuses.
- `src/server/google/oauth.ts`, `src/server/sheets/`, `src/server/export/`, `src/server/notifications/`.
- `src/app/(app)/`: pages (overview, transactions, explain, reports, budgets, automation,
  settings, notifications).
- `src/app/api/`: JSON API, `gmail/*`, `sheets/*`, `export`, `ingest/shortcut`, `ingest/explain`
  (device key).
- `scripts/`: `app.ts`, `worker.ts`, `db-dev.ts`, `migrate.ts`, `user.ts`, `seed-sample.ts`,
  `e2e-server.ts`, `make-email-fixture.mjs`.
- `docs/`: feasibility, plan, ADRs 0001–0009, `setup/` (gmail, iphone-shortcut, sheets,
  explain-shortcut), `server-transition.md`.

## Key decisions already made (don't relitigate)

No Docker locally (images built in CI and on the VPS). pg_ctl-managed local Postgres. Durable
queue in Postgres, not pg-boss. Gmail sync uses an overlapping search window. The transaction
type is the single source of truth for accounting. "Transfer" means own accounts only. Refunds
count in the original category, in the month they arrive. Corrections are audited and voids
never delete. Manual and Quick Add entries never count as automatic capture. No guessed
formats: unrecognised alerts, SMS and receipts go to a masked review queue (kept 7 days).
Explain "why" options live in the Shortcut, not the app (the reason is free text; the filter
lists what was used).

## Open items after the move

- Backups (M8) and the 30-day capture evaluation.
- Web push notifications become possible with HTTPS (could complement the Explain Shortcut).
- Parsers for SMS/receipts/savings-account emails when the user sends samples.
- Feasibility checks on the iPhone: does the Messages automation run without a tap (I2/I3)?
  What does PhonePe/GPay's Share send (I4)?
- `npm audit`: dev-only advisories; runtime clean.
- The Excel export hasn't been opened in real Excel/Numbers by the user yet.

## Working with this user

- Explain plainly and **one step at a time** for Windows, iPhone and server tasks; they build
  the Shortcuts themselves. Name the exact action/screen ("Ask for Text with …"), and ask for a
  screenshot early when they're stuck rather than guessing.
- Confirm before anything that publishes personal data (the repo is public).
- Report honestly what's verified and what isn't. Keep it concise.
