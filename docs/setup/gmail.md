# Gmail setup guide

This connects the tracker to the Gmail account that receives your bank and card alerts.
Access is **read-only**, and the app only opens emails from the alert addresses it knows.
You do this once. It takes about 15 minutes.

You will create your own Google Cloud project, so no third party is involved. Google's
console layout changes from time to time, so names may differ slightly from these steps.

## 1. Create a project and enable the Gmail API

1. Go to <https://console.cloud.google.com/> and sign in with the Google account that receives the alerts.
2. Project picker (top bar) → **New project** → name it e.g. `expense-tracker` → **Create**.
3. **APIs & Services → Library** → search **Gmail API** → **Enable**.

## 2. Configure Google Auth Platform (the consent screen)

**APIs & Services → Google Auth Platform**:

1. **Branding**: App name `Expense Tracker (personal)`, and your own address as the support and developer contact.
2. **Audience**: User type **External**. Add your own Gmail address under **Test users**.
3. **Data access** → **Add or remove scopes** → add `https://www.googleapis.com/auth/gmail.readonly` → **Save**.
4. **Audience** → **Publish app**, so the status becomes **In production**.

> **Why "In production" matters:** in **Testing** status, Google expires the access after
> **7 days**, and capture would silently stop every week. In production, an app that only
> you use counts as **personal use (under 100 users)**, so Google's verification process
> isn't required. You will see a "Google hasn't verified this app" warning when connecting;
> that's expected for your own personal app.
> ([Google: when verification is not needed](https://support.google.com/cloud/answer/13464323))

Don't submit the app for verification. It isn't needed for personal use, and verification for
Gmail scopes requires a paid security assessment.

## 3. Create the OAuth client

**Google Auth Platform → Clients → Create client**:

- Application type: **Web application**
- Name: `expense-tracker`
- **Authorized redirect URIs**, add both:
  - `http://localhost:3000/api/gmail/callback` (local development)
  - `https://YOUR-DOMAIN/api/gmail/callback` (when deployed)

Copy the **Client ID** and **Client secret**. You can download them again later from the same page.

## 4. Configure the app

Generate an encryption key. It encrypts the stored Google access token:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the values in `.env.local` (local) or in the server's `.env` (production). **Never commit
these files**; both are git-ignored.

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
TOKEN_ENCRYPTION_KEY=...the generated key...
```

Keep a copy of `TOKEN_ENCRYPTION_KEY` in your password manager. If it's lost, nothing breaks
except that you have to reconnect Gmail.

Restart the app, and start the worker in a second terminal:

```powershell
npm.cmd run dev
npm.cmd run worker
```

(In production the `worker` service in `compose.yaml` runs automatically.)

## 5. Connect

1. Open the app → **Automation** → **Connect Gmail**.
2. Choose your account. On the "Google hasn't verified this app" screen choose **Advanced →
   Go to Expense Tracker (unsafe)**. It's your own app.
3. Allow **"View your email messages and settings"** (read-only).
4. You're returned to the Automation page. The first check looks back `GMAIL_BACKFILL_DAYS`
   days (default 60). After that it checks every minute.

## What to check afterwards

- **Automation → Recently captured** lists the alerts it found.
- Each bank's row under **Capture sources** changes from "Available for testing" to
  **"Tested successfully"** only after a real alert from your Gmail has been parsed.
- **Needs a look** lists alerts it couldn't read. Please tell me about these: they're new
  formats (for example HDFC bank-account alerts) that need a parser.

## Disconnecting and revoking

- In the app: **Automation → Disconnect**. This revokes access at Google and deletes the stored
  token. Transactions already captured are kept.
- Or at Google: <https://myaccount.google.com/permissions> → Expense Tracker → **Remove access**.
  The app then shows "Needs reconnecting".

## When capture stops

| Symptom | Cause | Fix |
|---|---|---|
| "Needs reconnecting" | Access revoked, Google password changed (this revokes Gmail grants), or the app was left in Testing | Make sure step 2.4 is done, then **Reconnect Gmail** |
| "Temporarily failing" | Google API errors or network problems | Nothing: it retries automatically with backoff. Check the worker logs if it persists |
| Alerts in "Needs a look" | A bank changed its wording or sent a new alert type | Share the email (it will be redacted into a test fixture) so a parser can be added; then **Retry** |
| No new captures and no errors | Worker not running | `docker compose ps` on the server; locally run `npm run worker` |

Google can also expire an unused grant after about 6 months of inactivity. The worker uses it
every minute, so in practice this only happens if the worker has been stopped for months.

## Data handling

- Only emails from known bank alert addresses are fetched in full.
- Captured alerts keep just the sender, subject and a hash of the text. Unrecognised ones keep
  a masked excerpt (long numbers hidden) for 7 days, then it's deleted.
- The refresh token is stored encrypted (AES-256-GCM) and is never sent to the browser or logged.
