import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, buttonClass, Card, Definition, EmptyState, PageHeader, secondaryButtonClass } from "@/components/ui";
import { formatDateTime, formatInr } from "@/lib/format";
import { decimalToPaise } from "@/lib/money";
import { requireUser } from "@/server/auth/dal";
import { captureCapabilities, ingestionOverview, type CaptureStatus } from "@/server/capture/capabilities";
import { db } from "@/server/db/client";
import { gmailConfig } from "@/server/env";
import { getConnection } from "@/server/ingestion/gmail/service";
import { disconnectGmailAction, retryAction, syncNowAction } from "./actions";

export const metadata = { title: "Automation · Expenses" };

const CONNECT_MESSAGES: Record<string, string> = {
  connected: "Gmail connected. The first check looks back over recent alert emails; new ones are picked up every minute.",
  denied: "Gmail access was not granted.",
  state_mismatch: "The sign-in couldn't be verified. Please try again.",
  no_refresh_token: "Google didn't return lasting access. Remove the app at myaccount.google.com/permissions and connect again.",
  not_configured: "Gmail isn't configured on the server yet (see docs/setup/gmail.md).",
  error: "Connecting Gmail failed. Please try again.",
};

const STATUS_TONE: Record<CaptureStatus, "neutral" | "attention" | "danger" | "info"> = {
  "Tested successfully": "info",
  "Available for testing": "neutral",
  "Partially supported": "attention",
  "Awaiting authorization": "attention",
  "Not configured": "neutral",
  "Temporarily failing": "danger",
  "Unsupported by the current platform": "neutral",
  "Not built yet": "neutral",
  "Excluded by you": "neutral",
};

const QUEUE_LABELS: Record<string, string> = {
  pending: "Waiting",
  processing: "Processing",
  parsed: "Captured",
  not_transaction: "Not a transaction (ignored)",
  unrecognized: "Not recognised (needs a look)",
  failed: "Failed after retries",
};

const secs = (s: number | null) => (s === null ? "—" : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

export default async function AutomationPage({ searchParams }: PageProps<"/automation">) {
  const user = await requireUser();
  const notice = (await searchParams).gmail;
  let configured = false;
  try {
    configured = gmailConfig() !== null;
  } catch {
    configured = false;
  }
  const [conn, capabilities, overview] = await Promise.all([
    getConnection(db(), user.id),
    captureCapabilities(db(), user.id),
    ingestionOverview(db(), user.id),
  ]);
  const connected = conn?.status === "connected";
  const problemCount = (overview.counts.unrecognized ?? 0) + (overview.counts.failed ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Automation" />
      {typeof notice === "string" && CONNECT_MESSAGES[notice] && (
        <p role="status" className="rounded-xl border border-border bg-surface p-3 text-sm">
          {CONNECT_MESSAGES[notice]}
        </p>
      )}

      <Card title="Gmail">
        {!configured ? (
          <EmptyState>
            Not configured. The server needs a Google OAuth client and an encryption key before Gmail can be connected. Follow{" "}
            <code>docs/setup/gmail.md</code>.
          </EmptyState>
        ) : !conn || conn.status === "disconnected" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Connect the Gmail account that receives your bank and card alerts. Access is read-only, and only alert emails from your banks&apos;
              sending addresses are opened.
            </p>
            <a href="/api/gmail/connect" className={`${buttonClass} self-start`}>
              Connect Gmail
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{conn.emailAddress}</strong>
              <Badge tone={connected ? "info" : "attention"}>{connected ? "Connected" : "Needs reconnecting"}</Badge>
            </div>
            <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              <div>
                <dt className="inline text-muted">Last successful check: </dt>
                <dd className="inline">{conn.lastSyncAt ? formatDateTime(conn.lastSyncAt.toISOString()) : "Not yet"}</dd>
              </div>
              {conn.lastError && (
                <div>
                  <dt className="inline text-muted">Last error: </dt>
                  <dd className="inline">{conn.lastError}</dd>
                </div>
              )}
            </dl>
            {!connected && (
              <p>
                Google stopped accepting the stored access (it was revoked, expired, or your Google password changed).{" "}
                <a href="/api/gmail/connect" className="font-medium text-brand underline">
                  Reconnect Gmail
                </a>
                .
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              {connected && <ActionForm action={syncNowAction} submitLabel="Check now" pendingLabel="Checking…" buttonClassName={buttonClass} className="flex flex-col gap-2" />}
              <ActionForm action={disconnectGmailAction} submitLabel="Disconnect" pendingLabel="Disconnecting…" buttonClassName={secondaryButtonClass} className="flex flex-col gap-2" />
            </div>
          </div>
        )}
        <Definition>
          The worker checks every minute and re-checks the last two days each time, so emails missed during downtime are still found. Email bodies
          aren&apos;t stored: captured alerts keep only the sender and subject; unrecognised ones keep a masked excerpt for 7 days.
        </Definition>
      </Card>

      <Card title="Processing">
        <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
          {Object.entries(QUEUE_LABELS).map(([k, label]) => (
            <li key={k} className="rounded-xl border border-border p-3">
              <div className="text-muted">{label}</div>
              <div className="text-xl font-semibold">{overview.counts[k] ?? 0}</div>
            </li>
          ))}
        </ul>
        <div className="mt-4 text-sm">
          <h3 className="font-semibold">Speed (last 30 days)</h3>
          {overview.latency.total === 0 ? (
            <p className="text-muted">No automatically captured transactions yet.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              <li>
                {overview.latency.within5} of {overview.latency.total} ({Math.round((overview.latency.within5 / overview.latency.total) * 100)}%) processed
                within 5 minutes of the email reaching Gmail · median {secs(overview.latency.medianProcessingSec)}
              </li>
              <li>
                Bank delivery delay (payment time to email arrival), where the alert states a time: median {secs(overview.latency.medianDeliverySec)} (
                {overview.latency.withTime} alerts)
              </li>
            </ul>
          )}
        </div>
      </Card>

      <Card
        title={`Needs a look${problemCount ? ` (${problemCount})` : ""}`}
        action={
          problemCount > 0 ? <ActionForm action={retryAction} submitLabel="Retry all" buttonClassName="text-sm font-medium text-brand underline" className="flex" /> : undefined
        }
      >
        {overview.problems.length === 0 ? (
          <EmptyState>Nothing waiting. Alerts that can&apos;t be read, or fail repeatedly, appear here instead of being dropped.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {overview.problems.map((p) => {
              const payload = (p.payload ?? {}) as { from?: string; subject?: string; excerpt?: string };
              return (
                <li key={p.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="break-words">{payload.subject ?? "(subject not kept)"}</strong>
                    <Badge tone={p.parseStatus === "failed" ? "danger" : "attention"}>{QUEUE_LABELS[p.parseStatus]}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {payload.from ?? p.sourceIdentifier} · {p.receivedAt ? formatDateTime(p.receivedAt.toISOString()) : "time unknown"} · {p.lastError}
                  </div>
                  {payload.excerpt && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted">Show masked excerpt</summary>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-background p-2 text-xs whitespace-pre-wrap">{payload.excerpt}</pre>
                    </details>
                  )}
                  <ActionForm action={retryAction} submitLabel="Retry" buttonClassName="mt-2 text-sm font-medium text-brand underline" className="flex flex-col">
                    <input type="hidden" name="id" value={p.id} />
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {overview.recent.length > 0 && (
        <Card title="Recently captured">
          <ul className="flex flex-col text-sm">
            {overview.recent.map(({ source, merchant, amount, direction }) => (
              <li key={source.id} className="flex justify-between gap-3 border-t border-border py-2 first:border-t-0">
                <Link href={`/transactions/${source.transactionId}`} className="min-w-0 truncate hover:underline">
                  {merchant ?? "Transaction"} <span className="text-muted">· {source.parserId}</span>
                </Link>
                <span className="shrink-0 tabular-nums">
                  {direction === "debit" ? "−" : "+"}
                  {formatInr(decimalToPaise(amount))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Capture sources">
        <ul className="flex flex-col gap-3">
          {capabilities.map((c) => (
            <li key={c.id} className="rounded-xl border border-border p-3 text-sm" data-testid="capability">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{c.name}</strong>
                <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs md:grid-cols-2">
                <div>
                  <dt className="inline text-muted">How: </dt>
                  <dd className="inline">
                    {c.mechanism} · <strong>{c.mode}</strong>
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted">Permissions: </dt>
                  <dd className="inline">{c.permissions}</dd>
                </div>
                <div>
                  <dt className="inline text-muted">Gives: </dt>
                  <dd className="inline">{c.merchantAndAmount}</dd>
                </div>
                <div>
                  <dt className="inline text-muted">Reference: </dt>
                  <dd className="inline">{c.reference}</dd>
                </div>
                <div>
                  <dt className="inline text-muted">Tested: </dt>
                  <dd className="inline">{c.tested}</dd>
                </div>
                <div>
                  <dt className="inline text-muted">Last capture: </dt>
                  <dd className="inline">{c.lastSuccessAt ? formatDateTime(c.lastSuccessAt.toISOString()) : "None yet"}</dd>
                </div>
                {c.limitations && (
                  <div className="md:col-span-2">
                    <dt className="inline text-muted">Limitations: </dt>
                    <dd className="inline">{c.limitations}</dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
        <Definition>
          “Automatic” sources need no action from you after paying. “Tested successfully” for a Gmail source means it has captured a real alert from your
          own Gmail, not just a test sample.
        </Definition>
      </Card>
    </div>
  );
}
