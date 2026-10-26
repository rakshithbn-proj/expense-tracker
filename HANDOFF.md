# Handoff: private expense tracker

Read this first in a new chat. The original requirements are the user's "Master Build Prompt"
(20 sections, milestones 0–9). If the new chat doesn't have it, ask the user to paste it; this
file summarises what matters from it.

## What this is

A private, single-user expense tracker for one user in India (INR). It captures transactions
automatically wherever possible (Gmail bank alerts, iPhone Shortcuts, later statement imports),
applies strict accounting rules, and reports capture coverage honestly. It's a mobile-first PWA,
self-hosted later on a VPS with Docker Compose. Core principle from the spec: **never claim an
integration works until it's tested with real evidence; never fake or simulate capture.**

- Repo: `D:\Rakshith\expense_tracker`, GitHub `rakshithbn-proj/expense-tracker` (**public**), branch `main`.
- Stack: Next.js 16 (App Router, Cache Components **off**), TypeScript strict, PostgreSQL 18 +
  Drizzle, Vitest, Playwright, Tailwind 4. No chart library (hand-built SVG). Details: `docs/adr/`.

## Git state (important)

- Last **pushed** commit: `4ce2b26` (Milestone 3). CI passed on it.
- **Local commits NOT pushed**: `aca0308` (M4 Gmail), `f485b4d` (M5 server side),
  `b882107` (Shortcut plain-text replies, test-harness fix), `b3af46a` (this file), plus the
  Milestone 7 work (uncommitted at the end of the M7 session unless the user asked to commit).
- Why: M4 adds redacted fixtures of the user's real bank emails (`tests/fixtures/email/`).
  The user must approve them before they go into the public repo; they said they'd review
  once live alerts from their other cards arrive. **Ask before pushing.** After pushing, check
  CI with `gh run watch`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Milestones

| # | Status | Notes |
|---|---|---|
| 0 Feasibility | Done | `docs/capture-feasibility.md` (updated with real evidence in §6a) |
| 1 Foundation | Done | Auth (argon2id, DB sessions, rate limit), PWA shell, migrations, CI, Docker files |
| 2 Data model | Done | Accounting rules in `src/server/finance/accounting.ts` (ADR-0006) |
| 3 Dashboard/reports | Done | Overview, explorer, 14 reports, budgets, settings |
| 4 Gmail | Built and tested; **partly validated live** | 5 real HSBC alerts captured. HDFC, ICICI and RBL await live alerts |
| 5 iPhone | **Server side done**; Quick Add works from the user's iPhone | SMS automation and share-receipt Shortcuts not set up yet; no SMS or receipt parsers (no samples) |
| 6 Statements | **Deferred by the user** (2026-10-26): they'll do it later | Needs one statement per bank/card from the user (CSV/Excel or PDF?). Until then the coverage and reconciliation reports say "Not available yet" |
| 7 Sheets + notifications | **Done; Sheets tested live** (2026-10-26) | Sheets sync, CSV/Excel export, notification centre. Spreadsheet lives in an account the user chose in Settings (`docs/setup/sheets.md`). Design: ADR-0008 |
| 8 Security/backups | Not started | Needs a backup bucket (B2 or R2) |
| 9 Deploy + 30-day evaluation | Not started | Needs a VPS and DNS |

Tests at handoff: 269 unit/integration (Vitest, real embedded Postgres) and 52 E2E
(Playwright, desktop and mobile Chromium). Lint and typecheck clean.

## Live integrations and the user's setup (no secrets here)

- **Gmail:** connected through the user's own Google Cloud project (published "In production",
  `gmail.readonly`). The account that receives bank alerts **auto-forwards** them (a Gmail
  filter on the bank senders) to the account connected to the app. Forwarded alerts pass the
  sender check via Gmail's ARC result.
- **Sender verification:** an alert becomes a transaction only if Gmail's topmost
  `Authentication-Results` shows a DKIM pass (or ARC pass) for the bank's own domain
  (`src/server/ingestion/email/authentication.ts`).
- **Banks in scope:** HDFC (cards, including a RuPay card used for UPI), HSBC, ICICI (card;
  bank-account alerts still to be sampled), RBL. **SBI and AMEX are excluded at the user's
  request.** No HDFC or ICICI savings-account alert samples yet, so UPI payments from bank
  accounts aren't captured automatically. This is the biggest coverage gap.
- **User requirement: ignore OTP emails and SMS completely.** Nothing from them is stored
  (`isOtpMessage` in `parse-helpers.ts`). Real alerts that only say "never share your OTP"
  are still processed.
- **iPhone:** one device key exists. The Quick Add Shortcut posts to
  `http://<PC LAN IP>:3000/api/ingest/shortcut?format=text` over home Wi-Fi (temporary
  until deployment).
- Senders use the new `.bank.in` domains: see `src/server/ingestion/email/parsers/*`.

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
- Logs: `.data/logs/`. Local DB data: `.data/postgres/`. Original email samples (private, git-ignored): `.data/email-samples/`.
- Secrets live in `.env.local` (git-ignored): Google client ID/secret, `TOKEN_ENCRYPTION_KEY`.
  Never print them.
- To add a parser from a new alert email: `node scripts/make-email-fixture.mjs <eml> <out.json> "real=>fake" ...`,
  read the output, add an `expected` block, and add a template in `src/server/ingestion/email/parsers/`.

## Environment gotchas (learned the hard way)

- **Read `node_modules/next/dist/docs/` before Next.js work** (`AGENTS.md`): v16 differs from
  older versions (e.g. `proxy.ts` instead of middleware, `PageProps`/`RouteContext` helpers).
- The Bash tool breaks on heredocs containing quotes, and Python edits can turn `\b` into a
  backspace character. **Use the Write/Edit tools or a `.py` file in `.data/`** for code edits.
- **PostgreSQL on Windows:** embedded-postgres's `stop()` force-kills, which leaves stale lock
  files and orphaned PG18 `--forkchild` helpers holding ports. Use `scripts/lib/local-pg.ts`
  (`pg_ctl` with stdio ignored; piping its output hangs the caller). Test DBs call
  `removeOrphanedPostgresHelpers()` first.
- The Claude sandbox can't signal processes it didn't start; process control may need
  `dangerouslyDisableSandbox`.
- **The E2E server deliberately blanks the Google env vars** so tests never use the user's
  real credentials from `.env.local`.
- Tests that use a fixed clock must pass `now` into queue functions (`enqueueSource`,
  `resetForRetry` and so on); never rely on the database's `now()`.
- PowerShell 5.1: use `npm.cmd`/`npx.cmd`; no `&&`.

## Code map

- `src/server/finance/`: accounting, analytics, matching, rules, and the services for
  transactions, budgets, reports and categories.
- `src/server/ingestion/`: `email/` (decoding, sender verification, parsers, registry), `gmail/`
  (client, sync, queue processing), `shortcut/` (device keys, submissions), `ingest.ts`
  (source-agnostic: account resolution, dedup), `queue.ts` (durable `FOR UPDATE SKIP LOCKED`
  queue), `health.ts`, `mask.ts`.
- `src/server/capture/capabilities.ts`: the spec §4.2 capability matrix and statuses.
- `src/server/google/oauth.ts`: shared Google OAuth (auth URL, code exchange, revoke, access-token cache).
- `src/server/sheets/`: Sheets client and sync (full idempotent rewrite of the Transactions tab,
  fingerprint skip, backoff). `src/server/export/`: table definition, CSV (formula guard), XLSX + ZIP writer.
- `src/server/notifications/`: `rules.ts` (what should be shown) and `service.ts` (reconcile by
  dedup key, read/dismiss, 90-day retention). The worker runs capture → Sheets → notifications.
- `src/app/(app)/`: pages (overview, transactions, reports, budgets, automation, settings,
  notifications placeholder).
- `src/app/api/`: JSON API (session plus same-origin check), `gmail/connect|callback`,
  `sheets/connect|callback`, `export` (CSV/XLSX), `ingest/shortcut` (device key).
- `scripts/`: `app.ts`, `worker.ts`, `db-dev.ts`, `migrate.ts`, `user.ts`, `seed-sample.ts`,
  `e2e-server.ts`, `make-email-fixture.mjs`.
- `docs/`: feasibility, plan, ADRs 0001–0007, `setup/gmail.md`, `setup/iphone-shortcut.md`.

## Key decisions already made (don't relitigate)

No Docker locally (images built in CI and on the VPS). pg_ctl-managed local Postgres. Durable
queue in Postgres, not pg-boss. Gmail sync uses an overlapping search window (last sync − 2
days), not `history.list`. The transaction type is the single source of truth for accounting.
"Transfer" means own accounts only, and unknown debits are never assumed to be transfers.
Refunds count in the original category, in the month they arrive. Corrections are audited and
voids never delete. Manual and Quick Add entries never count as automatic capture. No guessed
formats: unrecognised alerts, SMS and receipts go to a masked review queue (kept 7 days).

## Next steps (suggested order)

> **Note (2026-10-26):** the user will do **statement import (Milestone 6) later**, and also put
> off security and backups (M8). Don't start either unless they ask. All functional work except
> statement import is built; remaining gaps need real samples (savings-account emails, other
> SMS, UPI receipts) or live confirmation (HDFC/ICICI/RBL card emails, SMS automation reliability).

1. Everything up to Milestone 7 is pushed (CI green). The ICICI SMS commit and the
   capture-status fix are committed locally but not pushed: push only when the user asks.
2. **Milestone 7 is done.** Sheets connected live to the account the user chose (they type it in
   Settings; Google's account chooser is forced and a mismatched account is revoked). Push
   notifications are not built (in-app only); web push needs HTTPS, so revisit at deployment.
3. Parsers for SMS and receipts once the user sends samples through the Shortcut (they land in
   Automation → Needs a look with masked excerpts). Also bank-account alert parsers when
   samples arrive.
4. **Milestone 6:** CSV statement import, reconciliation and coverage metrics (spec §12
   formulas; manual and imported entries never inflate automatic coverage).
5. **Milestone 8:** security review, encrypted restic backups to B2 or R2, restore test, health
   checks, and optional TOTP.
6. **Milestone 9:** VPS deployment (`compose.yaml` has db, migrate, web, worker, caddy), then
   connect Gmail on production and run the 30-day capture evaluation.

## Open items and known limitations

- Feasibility tests still to be done on the iPhone: does the Messages automation run without a
  tap and pass the SMS text (I2/I3)? What does PhonePe/GPay's Share send (I4)?
- The Docker image has been built in CI but never run; first real run is on the VPS.
- `npm audit`: dev-only advisories (eslint `braces`, drizzle-kit `esbuild`); runtime is clean.
- Insights and budget suggestions need 3 months of history; until then they correctly say so.
- Notifications are in-app only (Alerts page + badge); no push or email.
- The Excel writer is hand-built (no dependency); it was checked with openpyxl but not yet
  opened in real Excel or Numbers by the user.

## Working with this user

- Explain plainly and step by step for Windows and iPhone UI tasks; they're building the
  Shortcuts themselves.
- Confirm before anything that publishes personal data (the repo is public). Redact samples
  with the fixture script and show what will be committed.
- Report honestly what's verified and what isn't. Keep it concise.
