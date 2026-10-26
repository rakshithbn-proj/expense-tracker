# ADR-0008: Google Sheets sync, exports and notifications

Status: Accepted (Milestone 7). Tested against in-memory fakes of Google's APIs, and live: the
user connected Sheets to their chosen Google account and the spreadsheet filled (2026-10-26).
Live finding: the API rejects the `en_IN` spreadsheet locale, so none is set.

## Google Sheets sync

- **Permission:** a separate OAuth grant with only `drive.file`, which reaches nothing but the
  spreadsheet the app creates. It reuses the Gmail OAuth client (same project, extra redirect
  URI `/api/sheets/callback`) but never widens the read-only Gmail grant, and it may be a
  different Google account. The refresh token is encrypted like Gmail's.
- **Which account:** the user types the owning Google account in Settings. It's sent to Google
  as `login_hint`, and the callback compares it with the verified email in the ID token
  (`openid email` scopes, also non-sensitive); on a mismatch the grant is revoked and nothing
  is saved. Switching account clears the stored spreadsheet so a new one is created in the new
  account, rather than writing to a file the new account may not own.
- **Idempotent by construction:** each sync makes the Transactions tab an exact copy of the
  data, with one row per transaction ID. It resizes the tab to exactly header + N rows (which
  drops rows left over from a longer previous sync) and then writes every row. Repeating a sync,
  retrying after a failure halfway through, or two syncs at once can't duplicate or lose rows.
  The alternative (append new rows, find and update changed ones by ID) needs a read of the ID
  column on every sync and has more ways to drift; at a personal scale (thousands of rows) the
  full rewrite is a few requests.
- **Only when something changed:** a fingerprint of the transaction count and latest
  `updated_at` (plus categories and accounts, whose names appear in the sheet) is stored after
  each successful sync. The worker checks it every cycle and makes no Google calls if it's
  unchanged.
- **Retries:** failures back off exponentially (2 min to 6 h, the ingestion queue's schedule).
  A rejected token sets `needs_reauth` and stops retrying until the user reconnects. Other
  errors, including a 403 for "Sheets API not enabled", keep retrying, since fixing the setup
  makes the next attempt succeed. A deleted spreadsheet is recreated; a deleted tab is re-added.
  The new spreadsheet's ID is saved before anything is written, so a failed first sync never
  leads to a second spreadsheet.
- **Formula injection:** values are written with `valueInputOption=RAW`, so text is stored
  verbatim and never parsed as a formula. Numbers are sent as numbers.

## Exports

- `GET /api/export?format=csv|xlsx` with the explorer's filter parameters exports every
  matching transaction (capped at 100,000), not just the visible page. Session-authenticated,
  `no-store`, audited (row count only).
- **CSV:** RFC 4180, UTF-8 with BOM (so Excel reads ₹), CRLF. Text cells starting with `=`, `+`,
  `-`, `@`, tab or CR get a leading `'` (OWASP CSV-injection guidance). Numeric cells aren't
  touched, so negative amounts stay numbers.
- **Excel:** a small built-in writer (ZIP + SpreadsheetML; no dependency). Text is written as
  inline strings and amounts as numeric cells; no cell is ever a formula, so no escaping is
  needed. Checked with an independent reader (openpyxl) during development.

## Notification centre

- One `notifications` row per **dedup key** (unique per user). The worker re-evaluates every
  rule each cycle and reconciles: new keys are inserted, changed content is updated, and
  missing keys are resolved, so the process is idempotent.
- **Conditions** (Gmail or Sheets needs reconnecting, three or more consecutive failures,
  unreadable alerts per day, uncategorised transactions, other review items) resolve by
  themselves when they clear and reopen as unread if they come back. They can't be dismissed,
  because they'd only reappear. Problems become unread again when they get worse; counts of
  informational items change silently.
- **Daily summary** of the previous day appears at 07:00 IST and resolves the one before, so
  only the latest summary is open.
- **Events** (budget reaching its warning threshold, budget exceeded) never auto-resolve; the
  user dismisses them.
- If any rule fails, nothing is updated, so an error can't masquerade as a problem clearing.
- Read or resolved notifications are deleted after 90 days. Bodies hold counts and app-computed
  figures only; never tokens or email text.
- **Not built:** push or email delivery. Notifications are in-app only (badge on Alerts).
  Web push to an iPhone PWA is possible on iOS 16.4+ but needs HTTPS, so it waits for deployment.
