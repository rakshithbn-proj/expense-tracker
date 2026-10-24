# ADR-0004: Gmail integration

Status: Accepted (Milestone 4). Supersedes the Milestone 0 proposal on two points, marked "changed".

## Decision

- **Scope** `gmail.readonly` only. The OAuth client lives in the user's own Google Cloud project:
  External user type, publishing status **In production** (unverified, personal use).
  **Testing mode is not used**, because it expires refresh tokens after 7 days. Setup steps are in
  `docs/setup/gmail.md`.
- **Tokens:** only the refresh token is stored, encrypted with AES-256-GCM using
  `TOKEN_ENCRYPTION_KEY`. Access tokens live in worker memory. `invalid_grant` or 401/403 marks
  the connection "needs reauth" and pauses the queue without using up retries.
- **Changed: sync by overlapping search instead of `history.list`.** Every cycle (60 s) runs
  `messages.list` with `from:(<known alert senders>) after:<last successful sync − 2 days>`
  (first run: `GMAIL_BACKFILL_DAYS`). Enqueueing is idempotent (unique user + source + message
  id), so the overlap costs nothing. This covers downtime and Gmail search-index lag, and has no
  history ID that can expire. Cost: one list call a minute, well within quota.
- **Changed: durable queue in Postgres instead of pg-boss.** `transaction_sources` rows are written
  before processing and claimed with `FOR UPDATE SKIP LOCKED`, and a lock timeout reclaims work
  from a crashed worker. Backoff is 2, 4, 8 … minutes (capped at 6 h); after 8 attempts the item is
  "failed" and can be retried from the Automation page. The same rows are the permanent
  provenance (spec 7.4), so there's no second store.
- **Parsing:** one module per institution, matched by exact sender address, each with explicit
  templates built from real alerts (redacted fixtures in `tests/fixtures/email`). A known
  sender's email that looks like a transaction but matches no template is **unrecognized** and
  kept for review. It is never dropped. Non-transaction mail is ignored.
- **Data minimisation:** parsed alerts keep sender, subject and a text hash. Unrecognized alerts
  keep a masked excerpt (digit runs of 5+ masked) for 7 days. Bodies are never stored.
- **Accounts:** an alert is matched to the user's account by type + last digits (+ institution).
  If none exists, one is created from what the alert states. If several match, the account is
  left unknown and flagged for review.
- **Duplicates:** the Gmail message id is the deduplication key. A repeated UPI reference is
  matched to the existing transaction. A similar transaction captured another way (same account,
  amount and direction, ±1 day) is flagged "possible duplicate" for review rather than merged.
- **Pub/Sub push** is not used. Measured latency on the Automation page will show whether it's
  ever needed; polling would remain the recovery path.

## Not yet validated

Live Gmail authorization and real-time capture can only be confirmed after the user completes
`docs/setup/gmail.md`. Until a real alert is parsed, each Gmail source shows "Available for testing".
