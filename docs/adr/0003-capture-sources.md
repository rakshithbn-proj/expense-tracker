# ADR-0003: Transaction capture sources

Status: Proposed. Depends on device tests I1–I5 and Gmail tests G1–G2.

## Context

iOS offers no supported way to read PhonePe or Google Pay notifications (see
`docs/capture-feasibility.md`). UPI debits are alerted by the paying bank.

## Decision

Capture UPI at the **bank-alert layer**:

1. Gmail API adapter: primary, automatic, server-side.
2. iOS Message automation forwarding bank SMS: automatic on-device, supplementary.
3. Share-receipt Shortcut: user-triggered, labelled as such. It enriches or creates UPI transactions.
4. CSV statement reconciliation: completeness and the coverage denominator.
5. Manual entry: labelled manual.

`capture_method` is one of `auto_email`, `auto_sms`, `user_share`, `manual`, `statement_import`.
Only `auto_*` counts toward automatic coverage.

Cross-source deduplication matches on (account, amount, direction) plus a UPI RRN or card auth
code when present, otherwise a ±10-minute time window. When more than one candidate matches, the
event is ambiguous and goes to review. It is never auto-merged.

## Rejected

Scraping app databases, private APIs, UI automation of payment apps, unofficial aggregator scraping.
