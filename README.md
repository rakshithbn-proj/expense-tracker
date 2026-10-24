# Expense Tracker (private)

A self-hosted, single-user expense tracker that captures transactions automatically from bank
and card alerts, iPhone Shortcuts and statement imports. It reconciles them and reports capture
coverage honestly.

## Status

| Milestone | State |
|---|---|
| 0 Feasibility | Done. See the documents below |
| 1 Foundation | Done. Auth, PWA shell, Postgres + migrations, tests, CI and Docker files |
| 2 Financial data model | Done. Accounts, categories, rules, transactions, budgets, accounting rules, JSON API, sample seed |
| 3 Dashboard and explorer | Done. Overview, transaction explorer and detail, manual entry, 14 reports, budgets, settings |
| 4 Gmail ingestion | Built and tested against real (redacted) alerts from HDFC, HSBC, ICICI and RBL cards. **Live Gmail not yet connected**: follow [docs/setup/gmail.md](docs/setup/gmail.md) |
| 5 iPhone Shortcuts | Server side done: device keys, ingestion endpoint, Quick Add. SMS and receipt text are received and kept for review until real formats are seen. **Not yet tried on your iPhone**: follow [docs/setup/iphone-shortcut.md](docs/setup/iphone-shortcut.md) |
| 6–9 | Not started. Alerts screen shows "Not built yet"; coverage and reconciliation reports say they can't be measured yet |

Not verified yet: the Docker image has never been built (there's no Docker on the dev machine,
see ADR-0002). Its first build happens in GitHub Actions or on the VPS.

## Local development (Windows, no Docker)

Requirements: Node.js 24+ and Git. Commands below are for PowerShell; use `npm.cmd` if
`npm` is blocked by execution policy.

```powershell
npm.cmd install
Copy-Item .env.example .env.local     # first time only
npm.cmd run app:start                 # first time also: npm.cmd run user:create -- you@example.com
```

| Command | What it does |
|---|---|
| `npm.cmd run app:start` | Starts the database, applies migrations, then starts the web app (http://localhost:3000) and the worker, all in the background |
| `npm.cmd run app:stop` | Stops the worker and web app, then **shuts the database down cleanly** |
| `npm.cmd run app:status` | Shows what's running |

Everything runs in the background, so closing a terminal window doesn't stop it. **Always
finish with `app:stop`**, especially before shutting down the PC: that's what makes the
database close cleanly. Logs are in `.data/logs/` (`web.log`, `worker.log`, `postgres.log`).

To work on code with live output instead, run the pieces yourself: `npm.cmd run db:start` (Ctrl+C
stops it cleanly), then `npm.cmd run dev` and `npm.cmd run worker` in their own windows.

### Tests

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test              # unit + integration, against a throwaway real Postgres
npx.cmd playwright install chromium   # first time only
npm.cmd run test:e2e      # production build + browser tests at desktop and mobile sizes
```

None of these need the dev database running. Each starts its own temporary one.

### Sample data (development only)

```powershell
npm.cmd run db:seed:sample              # 2 months of SAMPLE transactions on 4 SAMPLE accounts
npm.cmd run db:seed:sample -- --remove  # deletes exactly the sample rows, nothing else
```

Everything seeded is flagged `is_sample` with capture method `sample`, so it can never be
mistaken for real data or counted as captured. The seed refuses to run when `NODE_ENV=production`.

### Screens

| Page | What it shows |
|---|---|
| Overview `/` | Net spending (with gross, refunds, pending), budgets, month-to-date line vs last month, categories, merchants, payment methods, weekday pattern, recent transactions, refunds and reversals, insights, capture sources |
| Transactions `/transactions` | Search and filters (date, category, account, method, app, amount, status, type, capture method, review), detail with provenance, links, audited corrections, rule creation, voiding, history; manual entry at `/transactions/new` |
| Reports `/reports` | Categories, month to month, merchants, accounts and cards, UPI vs cards, daily and weekly, recurring payments, budgets, cash flow, investments, refunds and reversals, capture coverage, reconciliation, insights. Each states what it includes |
| Budgets `/budgets` | Monthly limits overall and per category, warning thresholds, suggestions you approve one by one |
| Settings `/settings` | Accounts and cards (last digits only), categories, category rules |

Every figure comes from the same accounting functions (ADR-0006). Insights and budget
suggestions only appear with three months of history, and coverage is not shown until
statements can be imported (Milestone 6).

### API (session cookie; writes must come from this site)

| Method and path | Purpose |
|---|---|
| `GET /api/transactions` | Search and filter: `q, from, to, categoryIds, uncategorized, accountIds, paymentMethods, paymentApps, types, statuses, captureMethods, minAmountPaise, maxAmountPaise, needsReview, includeVoided, sort, order, page, pageSize` |
| `POST /api/transactions` | Manual entry (always recorded as `manual`) |
| `GET / PATCH / DELETE /api/transactions/:id` | Detail with links; audited correction (`createRule: true` to remember the category); void with `?reason=` |
| `GET / POST / DELETE /api/transactions/:id/links` | Suggested originals; link `{kind: refund\|reversal\|transfer, targetId}`; unlink |
| `GET /api/summary?month=YYYY-MM` | Net spending and separate totals (see ADR-0006) |
| `GET / PUT /api/budgets` | Budget usage for a month; set a monthly limit |
| `GET / POST /api/accounts`, `/api/categories`, `/api/rules` | Lists and creation |

Amounts are integer paise (₹1 = 100) in the API, and `numeric(14,2)` in the database.

### Alert email fixtures

Parsers are tested against redacted copies of real alerts in `tests/fixtures/email/`. To add one,
save the original `.eml` under the git-ignored `.data/email-samples/` and run:

```powershell
node scripts/make-email-fixture.mjs ".data/email-samples/<bank>/<file>.eml" tests/fixtures/email/<bank>/<name>.json "real=>fake" ...
```

It strips every link and comment, applies the replacements, refuses to write if any original
value survives, and lists what's left. Read the output before committing. Then add an
`expected` block to the JSON.

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
src/server/         Server-only code: env, db (schema, client, migrations), auth, audit, logger, api wrapper
src/server/finance/ Accounting rules, matching, categorization and the finance services
src/lib/            Code shared with the UI: money (paise), India-time dates, finance enums
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
