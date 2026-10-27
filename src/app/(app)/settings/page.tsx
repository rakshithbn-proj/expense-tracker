import { ActionForm } from "@/components/action-form";
import { Badge, buttonClass, Card, Definition, EmptyState, inputClass, PageHeader, secondaryButtonClass } from "@/components/ui";
import { ACCOUNT_TYPES } from "@/lib/finance-types";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { lookups } from "@/server/finance/reports-service";
import { listRules } from "@/server/finance/rules-service";
import { listDeviceKeys } from "@/server/ingestion/shortcut/keys";
import { formatDateTime } from "@/lib/format";
import { sheetsConfig } from "@/server/env";
import { getSheetsConnection } from "@/server/sheets/service";
import { getExplainSettings, parseSlotTimes, formatSlotTimes } from "@/server/explain/service";
import { DeviceKeyCreator } from "./device-keys";
import {
  addAccountAction,
  addCategoryAction,
  createDeviceKeyAction,
  disconnectSheetsAction,
  revokeDeviceKeyAction,
  syncSheetsNowAction,
  updateExplainSettingsAction,
  toggleAccountAction,
  toggleRuleAction,
  updateCategoryAction,
} from "./actions";

export const metadata = { title: "Settings · Expenses" };

const ACCOUNT_TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  bank_account: "Bank account",
  credit_card: "Credit card",
  wallet: "Wallet",
  cash: "Cash",
  investment: "Investment account",
  loan: "Loan",
};
const MATCH_LABELS = { merchant_exact: "Merchant is", merchant_contains: "Merchant contains", description_contains: "Description contains" } as const;
const label = "flex flex-col gap-1 text-xs font-medium text-muted";
const linkButton = "text-sm text-muted underline";

const SHEETS_MESSAGES: Record<string, string> = {
  connected: "Google Sheets connected and the spreadsheet is up to date.",
  connected_sync_failed: "Google Sheets connected, but the first update failed. The error is shown below; the app keeps retrying.",
  denied: "Access to Google Sheets was not granted.",
  state_mismatch: "The sign-in couldn't be verified. Please try again.",
  no_refresh_token: "Google didn't return lasting access. Remove the app at myaccount.google.com/permissions and connect again.",
  not_configured: "Google isn't configured on the server yet (see docs/setup/gmail.md).",
  error: "Connecting Google Sheets failed. Please try again.",
  wrong_account: "You approved with a different Google account than the one entered, so nothing was connected and that access was revoked. Try again and pick the account entered below.",
  invalid_account: "That doesn't look like an email address.",
};

// A plain GET form: the browser navigates to the connect route, which redirects to Google.
function SheetsConnectForm({ account, label }: { account: string | null; label: string }) {
  return (
    <form method="get" action="/api/sheets/connect" className="flex flex-wrap items-end gap-3" data-testid="sheets-connect-form">
      <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs font-medium text-muted">
        Google account that owns the spreadsheet
        <input name="account" type="email" required defaultValue={account ?? ""} placeholder="e.g. you@gmail.com" autoComplete="email" className={inputClass} />
      </label>
      <button type="submit" className={buttonClass}>
        {label}
      </button>
    </form>
  );
}

function isSheetsConfigured() {
  try {
    return sheetsConfig() !== null;
  } catch {
    return false;
  }
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const notice = (await searchParams).sheets;
  const [names, rules, keys, sheets] = await Promise.all([
    lookups(db(), user.id),
    listRules(db(), user.id),
    listDeviceKeys(db(), user.id),
    getSheetsConnection(db(), user.id),
  ]);
  const explain = await getExplainSettings(db(), user.id);
  const sheetsConnected = sheets?.status === "connected";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" />

      <Card title="Accounts and cards">
        {names.accounts.length === 0 ? (
          <EmptyState>No accounts yet. Add your bank accounts and each credit card below.</EmptyState>
        ) : (
          <ul className="mb-4 flex flex-col">
            {names.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-t-0">
                <span className="text-sm">
                  {names.accountName.get(a.id)} <span className="text-muted">· {ACCOUNT_TYPE_LABELS[a.accountType]}</span>{" "}
                  {a.isSample && <Badge>Sample</Badge>} {!a.isActive && <Badge>Hidden</Badge>}
                </span>
                <ActionForm action={toggleAccountAction} submitLabel={a.isActive ? "Hide" : "Show"} buttonClassName={linkButton} className="flex">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="isActive" value={String(!a.isActive)} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addAccountAction} submitLabel="Add account" buttonClassName={buttonClass} testId="add-account-form">
          <div className="grid gap-3 md:grid-cols-4">
            <label className={label}>
              Bank or issuer
              <input name="institutionName" required maxLength={80} placeholder="e.g. HDFC Bank" className={inputClass} />
            </label>
            <label className={label}>
              Name
              <input name="accountName" required maxLength={80} placeholder="e.g. Regalia card" className={inputClass} />
            </label>
            <label className={label}>
              Type
              <select name="accountType" defaultValue="bank_account" className={inputClass}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Last digits (optional)
              <input name="maskedIdentifier" inputMode="numeric" maxLength={6} pattern="[0-9]{2,6}" placeholder="e.g. 4321" className={inputClass} />
            </label>
          </div>
        </ActionForm>
        <Definition>Only the last 2–6 digits are stored, to tell accounts apart in alerts. Never enter a full card or account number.</Definition>
      </Card>

      <Card title="Categories">
        <ul className="mb-4 flex flex-col">
          {names.categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-end justify-between gap-2 border-t border-border py-2 first:border-t-0">
              <ActionForm action={updateCategoryAction} submitLabel="Rename" buttonClassName={linkButton} className="flex flex-1 items-end gap-2">
                <input type="hidden" name="id" value={c.id} />
                <input name="name" defaultValue={c.name} aria-label={`Name for ${c.name}`} maxLength={60} className={`${inputClass} max-w-xs`} />
              </ActionForm>
              <div className="flex items-center gap-2">
                {!c.isActive && <Badge>Inactive</Badge>}
                {c.systemKey !== "uncategorized" && (
                  <ActionForm action={updateCategoryAction} submitLabel={c.isActive ? "Deactivate" : "Activate"} buttonClassName={linkButton} className="flex">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="isActive" value={String(!c.isActive)} />
                  </ActionForm>
                )}
              </div>
            </li>
          ))}
        </ul>
        <ActionForm action={addCategoryAction} submitLabel="Add category" buttonClassName={buttonClass} className="flex flex-wrap items-end gap-3">
          <label className={`${label} flex-1`}>
            New category
            <input name="name" required maxLength={60} className={inputClass} />
          </label>
        </ActionForm>
        <Definition>Deactivated categories keep their past transactions but aren&apos;t offered for new ones.</Definition>
      </Card>

      <Card title="iPhone Shortcut keys">
        {keys.length > 0 && (
          <ul className="mb-4 flex flex-col">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
                <span>
                  <strong>{k.name}</strong> <span className="font-mono text-xs text-muted">{k.keyPrefix}…</span>
                  <span className="block text-xs text-muted">
                    Created {formatDateTime(k.createdAt.toISOString())} · {k.lastUsedAt ? `last used ${formatDateTime(k.lastUsedAt.toISOString())}` : "never used"}
                  </span>
                </span>
                {k.revokedAt ? (
                  <Badge>Revoked</Badge>
                ) : (
                  <ActionForm action={revokeDeviceKeyAction} submitLabel="Revoke" pendingLabel="Revoking…" buttonClassName={linkButton} className="flex">
                    <input type="hidden" name="id" value={k.id} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        <DeviceKeyCreator action={createDeviceKeyAction} />
        <Definition>
          A key lets a Shortcut on your phone send transactions to this app, and nothing else: it can&apos;t read your data. Only a fingerprint of
          it is stored. It sits inside the Shortcut, so never share that Shortcut; if you do, or lose the phone, revoke the key here. Each key is
          limited to 120 submissions an hour.
        </Definition>
      </Card>

      <Card title="Explain prompts (iPhone)" className="scroll-mt-4">
        <div id="explain">
          <ActionForm action={updateExplainSettingsAction} submitLabel="Save schedule" buttonClassName={buttonClass} testId="explain-settings-form">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={explain.enabled} className="h-4 w-4" />
              Ask me on my iPhone why each payment was made
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className={label}>
                Ask at these times (India time, 24-hour)
                <input name="slotTimes" required defaultValue={formatSlotTimes(parseSlotTimes(explain.slotTimes))} className={inputClass} />
              </label>
              <label className={label}>
                If skipped or not seen, ask again after (minutes)
                <input name="retryMinutes" type="number" min={5} max={180} required defaultValue={explain.retryMinutes} className={inputClass} />
              </label>
            </div>
          </ActionForm>
        </div>
        <Definition>
          At each time, payments captured since the previous one become due. Your phone shows them the next time the Shortcut runs (when you
          open one of your everyday apps), so a locked phone just means it waits. Skipped payments come back after the retry interval. Only
          spending is asked about, and only payments captured since {formatDateTime(explain.askFrom.toISOString())}. Unanswered ones wait on the{" "}
          <a href="/explain" className="underline">
            To explain
          </a>{" "}
          page. Setup: <code>docs/setup/explain-shortcut.md</code>.
        </Definition>
      </Card>

      <Card title="Google Sheets" className="scroll-mt-4">
        <div id="sheets" className="flex flex-col gap-3 text-sm">
          {typeof notice === "string" && SHEETS_MESSAGES[notice] && (
            <p role="status" className="rounded-xl border border-border p-3">
              {SHEETS_MESSAGES[notice]}
            </p>
          )}
          {!isSheetsConfigured() ? (
            <EmptyState>Not configured. It uses the same Google setup as Gmail; follow <code>docs/setup/sheets.md</code>.</EmptyState>
          ) : !sheets || sheets.status === "disconnected" ? (
            <>
              <p>
                Keep a copy of every transaction in a Google spreadsheet, updated within a minute of each change. The app can only see the one
                spreadsheet it creates, nothing else in your Drive.
              </p>
              <SheetsConnectForm account={sheets?.emailAddress ?? null} label="Connect Google Sheets" />
              <p className="text-xs text-muted">
                It doesn&apos;t have to be the account that receives your bank alerts. Google opens with this account selected, and the app refuses
                the connection if a different account approves it.
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {sheets.spreadsheetUrl ? (
                  <a href={sheets.spreadsheetUrl} target="_blank" rel="noreferrer" className="font-medium text-brand underline">
                    Open the spreadsheet
                  </a>
                ) : (
                  <strong>Spreadsheet not created yet</strong>
                )}
                {sheets.emailAddress && <span className="text-muted">in {sheets.emailAddress}</span>}
                <Badge tone={sheetsConnected ? (sheets.consecutiveFailures > 0 ? "attention" : "info") : "danger"}>
                  {!sheetsConnected ? "Needs reconnecting" : sheets.consecutiveFailures > 0 ? "Retrying" : "Connected"}
                </Badge>
              </div>
              <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2" data-testid="sheets-status">
                <div>
                  <dt className="inline text-muted">Last update: </dt>
                  <dd className="inline">
                    {sheets.lastSyncAt ? `${formatDateTime(sheets.lastSyncAt.toISOString())} · ${sheets.syncedRowCount ?? 0} rows` : "Not yet"}
                  </dd>
                </div>
                {sheets.lastError && (
                  <div className="sm:col-span-2">
                    <dt className="inline text-muted">Last error: </dt>
                    <dd className="inline break-words">{sheets.lastError}</dd>
                  </div>
                )}
                {sheetsConnected && sheets.nextAttemptAt && (
                  <div>
                    <dt className="inline text-muted">Next retry: </dt>
                    <dd className="inline">{formatDateTime(sheets.nextAttemptAt.toISOString())}</dd>
                  </div>
                )}
              </dl>
              {!sheetsConnected && (
                <>
                  <p>Google stopped accepting the stored access. Reconnect to resume updates.</p>
                  <SheetsConnectForm account={sheets.emailAddress} label="Reconnect Google Sheets" />
                </>
              )}
              <div className="flex flex-wrap gap-3">
                {sheetsConnected && (
                  <ActionForm action={syncSheetsNowAction} submitLabel="Sync now" pendingLabel="Syncing…" buttonClassName={buttonClass} className="flex flex-col gap-2" />
                )}
                <ActionForm action={disconnectSheetsAction} submitLabel="Disconnect" pendingLabel="Disconnecting…" buttonClassName={secondaryButtonClass} className="flex flex-col gap-2" />
              </div>
              {sheetsConnected && (
                <details>
                  <summary className="cursor-pointer text-muted">Use a different Google account</summary>
                  <p className="my-2 text-xs text-muted">
                    A new spreadsheet is created in the other account. The current one stays where it is but stops being updated.
                  </p>
                  <SheetsConnectForm account={null} label="Switch account" />
                </details>
              )}
            </>
          )}
        </div>
        <Definition>
          The “Transactions” tab holds one row per transaction (newest first, identified by its Transaction ID), excluding voided entries and sample
          data. The app rewrites that tab whenever anything changes, so edits made there are overwritten: add your own formulas or charts on other
          tabs. Text is written as plain values, never as formulas.
        </Definition>
      </Card>

      <Card title="Category rules">
        {rules.length === 0 ? (
          <EmptyState>
            No rules yet. When you correct a transaction&apos;s category, tick “Always use this category” to create one.
          </EmptyState>
        ) : (
          <ul className="flex flex-col">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
                <span>
                  {MATCH_LABELS[r.matchType]} “{r.matchValue}” → <strong>{names.categoryName.get(r.categoryId)}</strong>{" "}
                  <span className="text-muted">· priority {r.priority}</span> {r.isSample && <Badge>Sample</Badge>} {!r.isActive && <Badge>Off</Badge>}
                </span>
                <ActionForm action={toggleRuleAction} submitLabel={r.isActive ? "Turn off" : "Turn on"} buttonClassName={linkButton} className="flex">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="isActive" value={String(!r.isActive)} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <Definition>
          Rules apply to new transactions only, highest priority first (older rules win ties). Turning a rule off doesn&apos;t change transactions it
          already categorized.
        </Definition>
      </Card>
    </div>
  );
}
