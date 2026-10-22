# ADR-0005: Deployment and backups

Status: Proposed. Cost figures are estimates to re-check at deploy time.

## Decision

- One small VPS (2 vCPU / 2–4 GB RAM, Ubuntu LTS) running Docker Compose: `caddy` (automatic
  HTTPS), `web`, `worker`, `db` (Postgres, not exposed publicly).
- Backups: nightly `pg_dump`, then `restic` (client-side encrypted), sent to S3-compatible object
  storage off the VPS (Backblaze B2 or Cloudflare R2). Retention: 7 daily, 4 weekly, 6 monthly.
  A monthly restore test runs into a throwaway container.
- Health: `/healthz` (unauthenticated, returns only `ok`), plus the authenticated source-health page.
  An optional free external uptime check.

## Estimated recurring cost (to verify)

| Item | Type | Rough cost |
|---|---|---|
| VPS (e.g. Hetzner CX22 / similar Indian-region provider) | Paid | ~₹400–800 / month |
| Backup storage (< 1 GB) | Usage-based | ~₹0–50 / month (free tiers often cover it) |
| Domain | Paid, already owned | existing |
| Gmail API, Sheets API, Let's Encrypt | Free | ₹0 |
| Google Pub/Sub | Not used initially | ₹0 |
