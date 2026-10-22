# ADR-0004: Gmail integration

Status: Proposed

## Decision

- Scope `gmail.readonly` only. The OAuth client is in the user's own Google Cloud project,
  consent screen type **External**, publishing status **In production** (unverified, personal use).
  **Testing mode is not used**, because it expires refresh tokens after 7 days.
- Refresh token encrypted at rest (AES-256-GCM, key from env `TOKEN_ENCRYPTION_KEY`).
- Sync: an initial bounded backfill (configurable, default 90 days) using narrow `q` filters per
  institution rule. After that, `users.history.list` from the stored `historyId` every 60 s.
  If `historyId` has expired (404), fall back to a date-bounded `messages.list` catch-up.
- Processed Gmail message IDs are unique in `transaction_sources`, so reprocessing is a no-op.
- Only the parsed fields plus a redacted excerpt (≤ 500 chars, digits masked) are retained. The
  raw body is dropped after parsing, or after 7 days for failed parses that are awaiting a parser fix.
- Pub/Sub push is deferred. If latency measurements show polling is insufficient, it is added
  as an accelerator, and polling remains the recovery mechanism.
