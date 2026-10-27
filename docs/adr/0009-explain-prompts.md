# ADR-0009: "Explain" prompts on the iPhone

Status: Accepted. Server side built and tested; the Shortcut and automations are still to be
set up and tried on the user's iPhone.

## Context

Automatic capture gives the amount and payee but not the purpose. The user wants every new
spending payment brought back to the phone, asking **which (existing) category** and **why**,
shown over whatever app is in use, and to wait while the phone is locked and ask again 15
minutes after a skip. It's the review step, done on the phone.

## Decision

- **Trigger: iPhone Shortcuts automations, not push.** Shortcuts can't be woken by a server,
  can't run continuously, and there's no "on unlock" trigger. Instead the "Explain payments"
  Shortcut runs on **App → Is Opened** automations for the user's everyday apps (the first
  app opened after unlocking), optionally also on Time of Day automations. Considered and
  rejected: ntfy (user disliked its UI), a native app ($99/year Apple developer account, a
  Mac, weeks of work), web push (needs HTTPS, so only after deployment; listed in
  `docs/server-transition.md`).
- **The app owns the schedule.** Slot times (default 09, 12, 15, 18, 21 IST) and a retry
  interval (default 15 min) live in `explain_settings`. A batch is due once a slot has passed
  since the oldest waiting payment was captured; the batch includes everything waiting.
  Fetching a batch takes a **lease** for the retry interval (atomic UPDATE, so simultaneous
  automations get one batch), which gives "ask again in 15 minutes" and prevents re-asking
  on every app switch. `?manual=1` ignores schedule and lease.
- **What's asked:** non-voided, non-sample spending debits (purchase, fee) not failed or
  reversed, not yet explained, captured since `ask_from` (set when asking starts, so history
  isn't one huge batch). Card bills, own-account transfers and income are never asked.
- **Answers** go through the normal audited correction: existing category (by name from the
  Shortcut, matched case-insensitively; no new categories), optional reason (`transactions.reason`),
  `explained_at`, optional merchant rule. If "uncategorized" was the only review reason, the
  transaction is marked reviewed.
- **Device key scope widened, minimally:** besides submitting, a key can read only the
  payments waiting to be explained (amount, payee, account label, time) plus category names,
  and answer only those. Endpoint `GET/POST /api/ingest/explain`.
- Also: "N payments to explain" alert, Overview banner, **To explain** page, "Why" field on
  the transaction page and as a column in CSV/Excel exports and the Google Sheet (layout v2).
