# ADR-0007: iPhone Shortcut ingestion

Status: Accepted (Milestone 5). The server side is built and tested; the on-device behaviour
(feasibility tests I1–I5) is still to be checked on the user's iPhone.

## Decision

- **Endpoint:** `POST /api/ingest/shortcut`, JSON, authenticated only by a device key
  (`Authorization: Bearer etk_…`). It doesn't use the browser session, so it's excluded from
  the cookie redirect in `proxy.ts`.
- **Device keys:** 256-bit random, shown once, stored as SHA-256. They are revocable, record a
  last-used time, are limited to 120 submissions an hour, and can only submit, never read.
  The key necessarily lives inside the Shortcut; the guide tells the user never to share
  Shortcuts that contain it, and to revoke the key if they do.
- **Inputs and how they're counted:**
  - `quick_add` (typed by the user) → **manual** entry. The payment app is recorded because
    the user stated it.
  - `sms` (Messages automation) → **automatic** capture once a bank's SMS format is parsed.
  - `share` (receipt text, usually via Extract Text from Image) → **user-triggered**.
- **Durability and duplicates:** every submission is written to `transaction_sources` before
  processing, then processed immediately; if that fails, the worker retries it. A submission's
  identity is its `id` field if sent, otherwise a hash of its content (SMS and receipts), or of
  the content plus the minute (Quick Add). Double taps and automations firing twice therefore
  create nothing new.
- **No guessed formats:** no real bank SMS or UPI receipt has been seen yet, so none is parsed.
  Transaction-like text is kept masked for 7 days in the review queue, and those become the
  samples for parsers. OTP messages are dropped with nothing stored. Other text is ignored.
- **Not attempted:** reading PhonePe or Google Pay notifications. iOS doesn't allow it (see the
  feasibility report), so it stays "Unsupported by the current platform".
