import "server-only";
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import type { Executor } from "@/server/finance/db-types";
import { DomainError, NotFoundError } from "@/server/errors";

export type Severity = "info" | "warning" | "critical";
export type NotificationRow = typeof notifications.$inferSelect;

// What the rules say should currently be shown.
export type DesiredNotification = {
  key: string;
  kind: NotificationKind;
  severity: Severity;
  title: string;
  body: string;
  href: string | null;
};

// Conditions resolve themselves once they clear, and reopen if they come back. They can be
// marked read but not dismissed (they'd only reappear). The daily summary behaves the same way:
// only the latest one stays open. Budget events never auto-resolve; the user dismisses them.
const KINDS = {
  gmail_auth: { autoResolve: true, renotify: true },
  gmail_failing: { autoResolve: true, renotify: true },
  capture_issues: { autoResolve: true, renotify: true },
  uncategorized: { autoResolve: true, renotify: false },
  needs_review: { autoResolve: true, renotify: false },
  sheets_auth: { autoResolve: true, renotify: true },
  sheets_failing: { autoResolve: true, renotify: true },
  budget: { autoResolve: false, renotify: false },
  daily_summary: { autoResolve: true, renotify: false },
} as const;
export type NotificationKind = keyof typeof KINDS;

export const isDismissible = (kind: string) => !(KINDS[kind as NotificationKind]?.autoResolve ?? false);

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };
const RETENTION_MS = 90 * 86_400_000;

// Brings stored notifications in line with the desired set. Idempotent: running it twice with
// the same input changes nothing.
export async function applyNotifications(db: Database, userId: string, desired: DesiredNotification[], now = new Date()) {
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(notifications).where(eq(notifications.userId, userId));
    const byKey = new Map(existing.map((n) => [n.dedupKey, n]));
    const wanted = new Set<string>();

    for (const d of desired) {
      wanted.add(d.key);
      const rules = KINDS[d.kind];
      const row = byKey.get(d.key);
      const content = { kind: d.kind, severity: d.severity, title: d.title, body: d.body, href: d.href };
      if (!row) {
        await tx.insert(notifications).values({ userId, dedupKey: d.key, ...content, createdAt: now, updatedAt: now });
        continue;
      }
      if (row.resolvedAt) {
        // A cleared condition that came back is news again. A dismissed event stays dismissed.
        if (rules.autoResolve) await tx.update(notifications).set({ ...content, resolvedAt: null, readAt: null, updatedAt: now }).where(eq(notifications.id, row.id));
        continue;
      }
      const changed = row.title !== d.title || row.body !== d.body || row.severity !== d.severity || row.href !== d.href;
      if (!changed) continue;
      const louder = RANK[d.severity] > RANK[row.severity];
      await tx
        .update(notifications)
        .set({ ...content, updatedAt: now, ...((rules.renotify || louder) && row.readAt ? { readAt: null } : {}) })
        .where(eq(notifications.id, row.id));
    }

    const cleared = existing.filter((n) => !n.resolvedAt && !wanted.has(n.dedupKey) && KINDS[n.kind as NotificationKind]?.autoResolve);
    if (cleared.length) {
      await tx
        .update(notifications)
        .set({ resolvedAt: now, updatedAt: now })
        .where(inArray(notifications.id, cleared.map((n) => n.id)));
    }

    await tx
      .delete(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          lt(notifications.updatedAt, new Date(now.getTime() - RETENTION_MS)),
          or(isNotNull(notifications.resolvedAt), isNotNull(notifications.readAt)),
        ),
      );
  });
}

export async function listNotifications(db: Executor, userId: string) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.updatedAt)).limit(200);
  const active = rows.filter((n) => !n.resolvedAt).sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.updatedAt.getTime() - a.updatedAt.getTime());
  return { active, history: rows.filter((n) => n.resolvedAt).slice(0, 50) };
}

export async function unreadCount(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), isNull(notifications.resolvedAt)));
  return row?.n ?? 0;
}

export async function markRead(db: Executor, userId: string, id: string | "all", now = new Date()) {
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), ...(id === "all" ? [] : [eq(notifications.id, id)])));
}

export async function dismiss(db: Executor, userId: string, id: string, now = new Date()) {
  const [row] = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.id, id)));
  if (!row || row.resolvedAt) throw new NotFoundError("Notification");
  if (!isDismissible(row.kind)) throw new DomainError("not_dismissible", "This alert clears by itself once the problem is fixed.");
  await db.update(notifications).set({ readAt: row.readAt ?? now, resolvedAt: now, updatedAt: now }).where(eq(notifications.id, id));
}
