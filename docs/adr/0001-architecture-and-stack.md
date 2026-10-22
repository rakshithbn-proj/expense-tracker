# ADR-0001: Architecture and stack

Status: Proposed (Milestone 0)

## Decision

- **Language:** TypeScript (strict) end to end.
- **Web + API:** Next.js (App Router) in one deployable. It serves the PWA, server-rendered
  pages and authenticated route handlers. Ingestion endpoints are route handlers that only
  validate, authenticate and **persist a raw source event**. They never parse inline.
- **Worker:** a separate Node process from the same codebase. It runs the pipeline stages, Gmail
  polling, Sheets sync, notifications and the daily summary.
- **Database:** PostgreSQL 18, using Drizzle ORM with SQL migrations checked into Git.
- **Durable jobs:** `pg-boss` (queue stored in Postgres). This avoids running Redis, so there's
  one stateful service to back up. It gives retries, backoff, scheduling and dead-letter state.
  Job state is mirrored to the `sync_jobs` table for the UI.
- **Money:** `numeric(14,2)` in Postgres, and integer paise in TypeScript. No floats.
- **Time:** stored as `timestamptz` (UTC), displayed in `Asia/Kolkata`. Event time and capture time are kept separately.
- **Auth:** single local user. Password hashed with argon2id. DB-backed sessions (only a
  SHA-256 of the token is stored) in `HttpOnly; Secure; SameSite=Lax` `__Host-` cookies.
  Browser mutations use Server Actions, which are POST-only and which Next.js rejects when
  `Origin` doesn't match `Host`. Together with SameSite=Lax this is the CSRF defence, so no
  separate CSRF token is used. Any future cookie-authenticated route handler that mutates must
  check `Origin` itself. Optional TOTP is planned for Milestone 8. Recovery uses a server-side
  CLI command (`npm run user:reset-password`) run over SSH. There is no public reset endpoint.
- **Device credentials (Shortcuts):** per-device random tokens, stored hashed. They are scoped to
  `ingest:write`, revocable and rate-limited, and the UI shows when each was last used. The Shortcut
  contains only that token, never Google tokens or server secrets.
- **Testing:** Vitest (unit and integration against real Postgres), Playwright (E2E at mobile and desktop viewports).
- **UI:** Tailwind CSS and a small component set. Charts use Recharts.

## Pipeline

```
source → [ingest endpoint / poller] → source_events (raw, minimal, hashed)
       → job: parse → validate/normalize → dedupe/match → classify → categorize
       → upsert transactions + transaction_sources (one DB transaction)
       → enqueue: sheets-sync, metrics, notification (if needed)
```

Each stage is idempotent and keyed on `source_event_id`. A worker crash means the job is retried.
No record is lost because the raw event was committed before the HTTP 202 response.

## Alternatives considered

- Separate SPA + Express API: more moving parts, with no benefit for one user.
- Redis/BullMQ: adds a second stateful service.
- SQLite: simpler, but weaker concurrency between web and worker, and the spec prefers Postgres.
