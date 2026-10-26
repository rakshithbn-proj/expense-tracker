import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Definition, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { isDismissible, listNotifications, type NotificationRow } from "@/server/notifications/service";
import { dismissAction, markReadAction } from "./actions";

export const metadata = { title: "Alerts · Expenses" };

const SEVERITY = {
  critical: { label: "Action needed", tone: "danger" },
  warning: { label: "Check", tone: "attention" },
  info: { label: "Info", tone: "info" },
} as const;
const linkButton = "text-sm font-medium text-brand underline";

function Item({ n, active }: { n: NotificationRow; active: boolean }) {
  const unread = active && !n.readAt;
  return (
    <li className={`rounded-xl border p-3 text-sm ${unread ? "border-brand" : "border-border"}`} data-testid="notification">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <strong className="min-w-0 break-words">
          {unread && <span className="sr-only">Unread: </span>}
          {n.title}
        </strong>
        <span className="flex items-center gap-1">
          {unread && <Badge tone="info">New</Badge>}
          {active ? <Badge tone={SEVERITY[n.severity].tone}>{SEVERITY[n.severity].label}</Badge> : <Badge>{isDismissible(n.kind) ? "Dismissed" : n.kind === "daily_summary" ? "Replaced" : "Resolved"}</Badge>}
        </span>
      </div>
      <p className="mt-1">{n.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>{formatDateTime((n.resolvedAt ?? n.updatedAt).toISOString())}</span>
        {n.href && (
          <Link href={n.href} className={linkButton}>
            Open
          </Link>
        )}
        {unread && (
          <ActionForm action={markReadAction} submitLabel="Mark read" pendingLabel="…" buttonClassName={linkButton} className="flex">
            <input type="hidden" name="id" value={n.id} />
          </ActionForm>
        )}
        {active && isDismissible(n.kind) && (
          <ActionForm action={dismissAction} submitLabel="Dismiss" pendingLabel="…" buttonClassName={linkButton} className="flex">
            <input type="hidden" name="id" value={n.id} />
          </ActionForm>
        )}
      </div>
    </li>
  );
}

export default async function NotificationsPage() {
  // Layouts are not re-checked on client navigation, so every page authorizes itself.
  const user = await requireUser();
  const { active, history } = await listNotifications(db(), user.id);
  const unread = active.filter((n) => !n.readAt).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Alerts">
        {unread > 0 && <ActionForm action={markReadAction} submitLabel="Mark all read" pendingLabel="Marking…" buttonClassName={linkButton} className="flex" />}
      </PageHeader>

      <Card title={`Open${active.length ? ` (${active.length})` : ""}`}>
        {active.length === 0 ? (
          <EmptyState>Nothing needs your attention.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((n) => (
              <Item key={n.id} n={n} active />
            ))}
          </ul>
        )}
        <Definition>
          Checked every minute by the background worker. Problems (a disconnected source, alerts that couldn&apos;t be read, uncategorised transactions)
          clear by themselves once fixed. Yesterday&apos;s summary appears at 7 am and replaces the previous one. Budget warnings stay until you dismiss them.
        </Definition>
      </Card>

      {history.length > 0 && (
        <Card title="Earlier">
          <ul className="flex flex-col gap-3">
            {history.map((n) => (
              <Item key={n.id} n={n} active={false} />
            ))}
          </ul>
          <Definition>Read and cleared alerts are deleted after 90 days.</Definition>
        </Card>
      )}
    </div>
  );
}
