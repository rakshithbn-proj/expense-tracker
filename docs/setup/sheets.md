# Google Sheets setup guide

This keeps a copy of every transaction in a Google spreadsheet in your own Drive, updated by the
worker within about a minute of any change. It reuses the Google Cloud project and OAuth client
from the [Gmail setup](gmail.md), so do that first. It takes about 5 minutes.

The app asks for the **`drive.file`** permission, so it can see and edit **only the
spreadsheet it creates**, nothing else in your Drive. It also asks for the account's email
address, to confirm the spreadsheet goes to the account you chose. This is a separate grant
from the read-only Gmail one, and **it can be a different Google account** from the one that
receives your alerts: you enter which account in Settings.

## 1. Enable the Google Sheets API

1. Go to <https://console.cloud.google.com/> and select the same project as for Gmail (e.g. `expense-tracker`).
2. **APIs & Services → Library** → search **Google Sheets API** → **Enable**.

## 2. Add the scope and the redirect address

**APIs & Services → Google Auth Platform**:

1. **Data access** → **Add or remove scopes** → add these three → **Save**:
   - `https://www.googleapis.com/auth/drive.file`
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email` (shown as `.../auth/userinfo.email`)

   They're all non-sensitive, so the app stays "In production" without verification.
2. **Audience**: if the app is still in **Testing**, add the spreadsheet account under **Test
   users**. (Once it's **In production**, any account you own can connect.)
3. **Clients** → open the `expense-tracker` client → under **Authorized redirect URIs** add:
   - `http://localhost:3000/api/sheets/callback` (local development)
   - `https://YOUR-DOMAIN/api/sheets/callback` (when deployed)
4. **Save**. Google says changes can take a few minutes to apply.

Nothing changes in `.env.local`: the same client ID, secret and encryption key are used.

## 3. Connect

1. Open the app → **Settings** → **Google Sheets**. In **Google account that owns the
   spreadsheet**, type the account you want (for example your main Gmail, not the one that
   receives bank alerts) → **Connect Google Sheets**.
2. Google opens with that account selected; if it isn't, pick it. On "Google hasn't verified
   this app" choose **Advanced → Go to Expense Tracker (unsafe)**: it's your own app.
3. Allow **"See, edit, create and delete only the specific Google Drive files you use with this
   app"** (and seeing your email address).
   If you approve with a different account than the one you typed, the app revokes that access
   and connects nothing.
4. You're returned to Settings. The app creates a spreadsheet called **Expense tracker** and
   fills it straight away. **Open the spreadsheet** links to it.

## What's in the spreadsheet

- One tab, **Transactions**, with a header row and one row per transaction, newest first.
  The **Transaction ID** column identifies each row. Voided entries and sample data are left out.
- Amounts are real numbers (two columns: the positive amount, and a signed amount that is
  negative for money out), so `SUM` and pivot tables work.
- Every value is written as plain data, never as a formula, so text from a bank alert can't
  run anything in your sheet.
- The app **rewrites the Transactions tab** whenever anything changes (a new transaction, a
  correction, a renamed category). Don't edit that tab: put your own formulas, pivots or charts
  on other tabs, referring to it.

## When syncing fails

| What Settings shows | Cause | Fix |
|---|---|---|
| "Retrying" with "Google Sheets API has not been used in project…" | Step 1 wasn't done | Enable the API; the next retry succeeds |
| "Retrying" with a 5xx or 429 error | Google is having problems, or rate limits | Nothing: retries back off from 2 minutes up to 6 hours. **Sync now** retries immediately |
| "Needs reconnecting" | Access was removed at Google, or your Google password changed | **Reconnect Google Sheets**. The same spreadsheet is reused and rewritten |
| `redirect_uri_mismatch` from Google when connecting | Step 2.3 missing or mistyped | Add the exact callback address shown above |
| "You approved with a different Google account" | Another account was picked on Google's screen | Connect again and pick the account you typed |

After 3 failures in a row an alert appears under **Alerts**, and it clears by itself once a
sync succeeds. If you delete the spreadsheet, the next sync creates a new one. If you delete
the Transactions tab, it's added back. (A spreadsheet in the Bin still counts as existing:
restore it, or empty the Bin so a fresh one is created.)

## Switching to another account

**Settings → Google Sheets → Use a different Google account**: enter the other account and
connect. A new spreadsheet is created there; the old one stays in the first account's Drive
but stops being updated. Access for the first account is replaced, so also remove it at
<https://myaccount.google.com/permissions> (signed in as that account) if you like.

## Disconnecting

**Settings → Google Sheets → Disconnect** revokes the app's access at Google and deletes the
stored token. The spreadsheet stays in your Drive; it just stops being updated.

## Exports without Google

Independently of Sheets, **Transactions → Export CSV / Export Excel** downloads every
transaction matching the current filters (not just the page on screen). In the CSV file,
text that starts with `=`, `+`, `-`, `@` or a tab gets a leading `'`, so Excel and Sheets show
it as text instead of running it as a formula. The Excel file stores text and numbers as typed
cells, which are never formulas.
