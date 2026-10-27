# Moving from the home PC to the server: checklist

Everything that must change when the app moves from the Windows PC (`http://<PC LAN IP>:3000`)
to the VPS (`https://YOUR-DOMAIN`). Keep this updated whenever something is added that
depends on where the app runs. Milestone 9 works through this list.

## 1. Data and secrets

- [ ] Copy the database: `pg_dump` the local database (port 5433) and restore it on the server,
      so transactions, rules, settings, device keys and connections carry over.
- [ ] Use the **same `TOKEN_ENCRYPTION_KEY`** on the server. The stored Gmail and Google Sheets
      refresh tokens are encrypted with it; with the same key neither needs reconnecting.
- [ ] Same `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in the server's `.env`.
- [ ] Set `APP_ORIGIN=https://YOUR-DOMAIN`. It builds the OAuth redirect addresses and the
      endpoint shown when creating a device key.
- [ ] Create the server login (`user:create`) only if the database isn't copied.

## 2. Google Cloud console (same project)

- [ ] **Clients → expense-tracker → Authorized redirect URIs**: add
      `https://YOUR-DOMAIN/api/gmail/callback` and `https://YOUR-DOMAIN/api/sheets/callback`.
      Remove the `localhost` ones once the PC copy is retired.
- [ ] Confirm the app is still **In production** (Testing expires tokens after 7 days).
- [ ] If the database was **not** copied: reconnect Gmail (Automation) and Google Sheets
      (Settings, same Google account so the same spreadsheet is reused).

## 3. iPhone Shortcuts (replace the address in every one)

Every Shortcut that calls the app uses the PC address now. Change `http://<PC LAN IP>:3000` to
`https://YOUR-DOMAIN` in:

- [ ] **Quick Add**: `…/api/ingest/shortcut?format=text`
- [ ] **SMS forwarding** automation: `…/api/ingest/shortcut`
- [ ] **Share receipt** Shortcut (if set up): `…/api/ingest/shortcut`
- [ ] **Explain payments** (both URLs): `…/api/ingest/explain` and `…/api/ingest/explain?format=text`
      (and `?manual=1` in the by-hand copy)
- [ ] Device keys keep working if the database was copied. Otherwise create a new key in
      Settings and paste it into each Shortcut's `Authorization` header.

What improves: Shortcuts then work **away from home**. Until then they work on home Wi-Fi only.

## 4. Phone and browser

- [ ] Open `https://YOUR-DOMAIN` in Safari, sign in, **Share → Add to Home Screen** (the PWA
      installed from the PC address won't follow the move).
- [ ] Remove the old home-screen icon that points at the PC.

## 5. Running services

- [ ] `docker compose up -d` (db, migrate, web, worker, caddy). The worker replaces
      `npm run app:start` on the PC; check `docker compose ps` shows it running.
- [ ] Stop the PC's worker (`npm.cmd run app:stop`) once the server is live, so two workers
      don't both poll Gmail. (Double capture would be deduplicated, but there's no reason to run both.)
- [ ] HTTPS certificate via Caddy, then confirm cookies are `Secure` (automatic in production).

## 6. Things that become possible on the server (not built yet)

- [ ] **Web push notifications** to the iPhone home-screen app (iOS 16.4+ needs HTTPS). Could
      replace or complement the explain Shortcut's app-open trigger.
- [ ] Backups (Milestone 8): encrypted restic to Backblaze B2 or Cloudflare R2, plus a restore test.

## 7. After the move, verify

- [ ] Automation page: Gmail "Connected", a new alert captured within a minute.
- [ ] Settings → Google Sheets: "Sync now" succeeds and the same spreadsheet updates.
- [ ] Quick Add and the explain prompt both work **on mobile data** (Wi-Fi off).
- [ ] Alerts page: no "needs reconnecting" alerts.
