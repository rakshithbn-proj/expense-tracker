# Implementation Plan and Risk Register

## Milestone order (adjusted from the spec)

The spec's order is kept. One change: **parser fixtures (M4) depend on redacted samples from the
user (G2).** Those samples should be collected while M1–M3 are built, so that M4 doesn't stall.

| M | Scope | Blocked by |
|---|---|---|
| 0 | Environment, feasibility, ADRs (this) | — |
| 1 | Repo, Next.js + TS, Postgres + migrations, auth, PWA shell, Vitest/Playwright, lint | Docker install (or fallback decision) |
| 2 | Data model, accounting rules, CRUD/filter APIs, labelled synthetic seed | — |
| 3 | Dashboard, explorer, reports, budgets | — |
| 4 | Gmail OAuth + parsers + catch-up + retries | Google Cloud project; samples G1/G2 |
| 5 | Device tokens, Shortcut ingest endpoint, SMS + share Shortcuts | Device tests I1–I5 |
| 6 | CSV import + reconciliation + coverage metrics | Statement samples S1/S2 |
| 7 | Sheets sync, notification centre, summaries | Google OAuth |
| 8 | Security review, backups, restore test | Backup bucket |
| 9 | VPS deploy, real-source validation, 30-day evaluation | VPS, DNS |

## Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Banks (esp. SBI/ICICI) don't email UPI debits | High | Coverage < 99% | SMS automation, share Shortcut, statement reconciliation. Measure per source |
| R2 | Gmail refresh token silently expires (Testing mode) | High if misconfigured | Ingestion stops | Production publishing status, `invalid_grant` alert, source-health page |
| R3 | Bank email templates change | Medium | Parser failures | Per-issuer parsers with fixtures, unparsed → review queue + notification |
| R4 | iOS Message automation unreliable, needs a confirmation tap, or doesn't pass the text | Medium | SMS source weak | Treat as supplementary. Measure in I2/I3 |
| R5 | Same transaction from email + SMS + share → duplicates | High | Inflated spending | Cross-source matching (ADR-0003). Ambiguous matches → review |
| R6 | Card issuers offer only PDF statements | Medium | Reconciliation gap for cards | Investigate PDF text extraction in M6, or a manual CSV template |
| R7 | Device token leaks via shared Shortcut | Low | Spam/false transactions | Scoped, revocable, rate-limited tokens. Never share the Shortcut file with token embedded |
| R8 | Coverage target unprovable with little data | Medium | Can't claim 99% | Report "insufficient evidence" per spec |
| R9 | Low local disk space (~22 GB free on D:) | Low | Docker issues | Keep Docker data on C: (default) or prune images |

## Unresolved external dependencies

1. WSL2 + Docker Desktop installation (user, admin rights).
2. iPhone tests I1–I5 (user, on device).
3. Gmail alert inventory and redacted samples G1–G2 (user).
4. Statement formats and samples S1–S2 (user).
5. Google Cloud project with OAuth client (guided in M4).
6. VPS, DNS, backup bucket (guided in M8/M9).
