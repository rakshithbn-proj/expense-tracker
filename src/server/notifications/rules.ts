import "server-only";
import { and, count, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { addDays, istDate, istMonth } from "@/lib/dates";
import { formatDate, formatInr, formatMonth } from "@/lib/format";
import type { Database } from "@/server/db/client";
import { gmailConnections, sheetsConnections, sourceHealth, transactionSources, transactions, users } from "@/server/db/schema";
import { budgetReport } from "@/server/finance/budgets-service";
import { lookups } from "@/server/finance/reports-service";
import { summarizeRange } from "@/server/finance/transactions-service";
import { getExplainSettings, listToExplain } from "@/server/explain/service";
import { applyNotifications, type DesiredNotification } from "./service";

// A source must fail this many times in a row before it's worth interrupting the user.
const FAILURES_BEFORE_ALERT = 3;
// The summary of yesterday replaces the previous one from this hour (India time).
const DAILY_SUMMARY_HOUR = 7;
const AUTOMATIC = new Set(["auto_email", "auto_sms"]);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const istHour = (now: Date) => new Date(now.getTime() + 5.5 * 3_600_000).getUTCHours();

async function connectionRules(db: Database, userId: string): Promise<DesiredNotification[]> {
  const out: DesiredNotification[] = [];
  const [[gmail], [gmailHealth], [sheets]] = await Promise.all([
    db.select().from(gmailConnections).where(eq(gmailConnections.userId, userId)),
    db.select().from(sourceHealth).where(and(eq(sourceHealth.userId, userId), eq(sourceHealth.sourceType, "gmail"))),
    db.select().from(sheetsConnections).where(eq(sheetsConnections.userId, userId)),
  ]);

  if (gmail?.status === "needs_reauth") {
    out.push({
      key: "gmail_auth",
      kind: "gmail_auth",
      severity: "critical",
      title: "Gmail needs reconnecting",
      body: "Google stopped accepting the app's access, so bank alert emails are not being captured. Reconnect Gmail in Automation; alerts that arrived meanwhile are picked up afterwards.",
      href: "/automation",
    });
  } else if (gmail?.status === "connected" && gmailHealth && gmailHealth.status !== "operational" && gmailHealth.consecutiveFailures >= FAILURES_BEFORE_ALERT) {
    out.push({
      key: "gmail_failing",
      kind: "gmail_failing",
      severity: "warning",
      title: "Gmail checks are failing",
      body: `The last ${gmailHealth.consecutiveFailures} checks for new alert emails failed${gmail.lastError ? ` (${gmail.lastError})` : ""}. The app keeps retrying, and nothing is lost: the next successful check covers the gap.`,
      href: "/automation",
    });
  }

  if (sheets?.status === "needs_reauth") {
    out.push({
      key: "sheets_auth",
      kind: "sheets_auth",
      severity: "critical",
      title: "Google Sheets needs reconnecting",
      body: "Google stopped accepting the app's access to your spreadsheet, so it is no longer being updated. Reconnect it in Settings.",
      href: "/settings#sheets",
    });
  } else if (sheets?.status === "connected" && sheets.consecutiveFailures >= FAILURES_BEFORE_ALERT) {
    out.push({
      key: "sheets_failing",
      kind: "sheets_failing",
      severity: "warning",
      title: "Google Sheets sync is failing",
      body: `The last ${sheets.consecutiveFailures} attempts to update your spreadsheet failed${sheets.lastError ? ` (${sheets.lastError})` : ""}. The app keeps retrying; your data in the app is unaffected.`,
      href: "/settings#sheets",
    });
  }
  return out;
}

// One notification per day on which alerts arrived that couldn't be turned into transactions.
async function captureRules(db: Database, userId: string): Promise<DesiredNotification[]> {
  const day = sql<string>`to_char(${transactionSources.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day, status: transactionSources.parseStatus, n: count() })
    .from(transactionSources)
    .where(and(eq(transactionSources.userId, userId), inArray(transactionSources.parseStatus, ["unrecognized", "failed"])))
    .groupBy(day, transactionSources.parseStatus);

  const byDay = new Map<string, { unrecognized: number; failed: number }>();
  for (const r of rows) {
    const entry = byDay.get(r.day) ?? { unrecognized: 0, failed: 0 };
    entry[r.status as "unrecognized" | "failed"] += r.n;
    byDay.set(r.day, entry);
  }
  return [...byDay.entries()].map(([date, c]) => {
    const total = c.unrecognized + c.failed;
    const parts = [c.unrecognized && `${c.unrecognized} not recognised`, c.failed && `${c.failed} failed after retries`].filter(Boolean).join(", ");
    return {
      key: `capture_issues:${date}`,
      kind: "capture_issues" as const,
      severity: "warning" as const,
      title: `${plural(total, "alert")} from ${formatDate(date)} couldn't be recorded`,
      body: `${parts}. Nothing was guessed: they wait in Automation → Needs a look, where you can retry them.`,
      href: "/automation",
    };
  });
}

async function reviewRules(db: Database, userId: string): Promise<DesiredNotification[]> {
  const live = and(eq(transactions.userId, userId), isNull(transactions.voidedAt), eq(transactions.isSample, false));
  const [[uncategorized], [review]] = await Promise.all([
    db
      .select({ n: count() })
      .from(transactions)
      .where(
        and(
          live,
          isNull(transactions.categoryId),
          // Once marked reviewed, an uncategorised payment is accepted as it is.
          eq(transactions.needsReview, true),
          inArray(transactions.transactionType, ["purchase", "fee", "refund"]),
          ne(transactions.transactionStatus, "failed"),
        ),
      ),
    // Being uncategorised is covered above; this counts every other reason (possible duplicates,
    // unmatched refunds, unknown accounts...).
    db
      .select({ n: count() })
      .from(transactions)
      .where(and(live, eq(transactions.needsReview, true), or(isNull(transactions.reviewReason), ne(transactions.reviewReason, "uncategorized")))),
  ]);
  const out: DesiredNotification[] = [];
  if (uncategorized.n > 0) {
    out.push({
      key: "uncategorized",
      kind: "uncategorized",
      severity: "info",
      title: `${plural(uncategorized.n, "transaction")} without a category`,
      body: "They count in your totals as “Uncategorized”. Pick a category, and tick “Always use this category” to create a rule for next time.",
      href: "/transactions?category=uncategorized",
    });
  }
  if (review.n > 0) {
    out.push({
      key: "needs_review",
      kind: "needs_review",
      severity: "warning",
      title: `${plural(review.n, "transaction")} ${review.n === 1 ? "needs" : "need"} review`,
      body: "Possible duplicates, refunds or reversals that couldn't be matched to a payment, or an unknown account. Check each one so totals stay right.",
      href: "/transactions?review=1",
    });
  }
  return out;
}

async function explainRule(db: Database, userId: string, now: Date): Promise<DesiredNotification[]> {
  const settings = await getExplainSettings(db, userId, now);
  if (!settings.enabled) return [];
  const n = (await listToExplain(db, userId, now)).length;
  if (n === 0) return [];
  return [
    {
      key: "to_explain",
      kind: "to_explain",
      severity: "info",
      title: `${plural(n, "payment")} to explain`,
      body: "Say why each one was made and pick its category. Your iPhone asks at the scheduled times; you can also answer here.",
      href: "/explain",
    },
  ];
}

async function budgetRules(db: Database, userId: string, now: Date): Promise<DesiredNotification[]> {
  const month = istMonth(now);
  const [report, names] = await Promise.all([budgetReport(db, userId, month), lookups(db, userId)]);
  const all = [...(report.overall ? [report.overall] : []), ...report.categories];
  return all
    .filter((b) => b.state !== "ok")
    .map((b) => {
      const name = b.categoryId ? (names.categoryName.get(b.categoryId) ?? "Category") : "Overall";
      const label = b.categoryId ? `${name} budget` : "Overall budget";
      return {
        key: `budget:${month}:${b.categoryId ?? "overall"}:${b.state}`,
        kind: "budget" as const,
        severity: "warning" as const,
        title: b.state === "exceeded" ? `${label} exceeded` : `${label} at ${b.percentUsed}%`,
        body: `${formatInr(Math.max(0, b.spentPaise))} of ${formatInr(b.limitPaise)} spent in ${formatMonth(month)}${
          b.state === "exceeded" ? `, ${formatInr(-b.remainingPaise)} over.` : `; ${formatInr(b.remainingPaise)} left.`
        }`,
        href: "/budgets",
      };
    });
}

async function dailySummaryRule(db: Database, userId: string, now: Date): Promise<DesiredNotification[]> {
  // Before 7 am the previous summary (of the day before yesterday) is still the current one.
  const day = addDays(istDate(now), istHour(now) < DAILY_SUMMARY_HOUR ? -2 : -1);
  const [user] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  if (!user || day < istDate(user.createdAt)) return [];

  const [summary, byMethod] = await Promise.all([
    summarizeRange(db, userId, { start: day, endExclusive: addDays(day, 1) }),
    db
      .select({ method: transactions.captureMethod, n: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.voidedAt), eq(transactions.isSample, false), gte(transactions.transactionDate, day), lt(transactions.transactionDate, addDays(day, 1))))
      .groupBy(transactions.captureMethod),
  ]);
  const total = byMethod.reduce((s, r) => s + r.n, 0);
  const automatic = byMethod.filter((r) => AUTOMATIC.has(r.method)).reduce((s, r) => s + r.n, 0);
  const body =
    total === 0
      ? "No transactions were recorded for this day. If you did spend, check Automation for capture problems."
      : `Net spending ${formatInr(summary.netSpendPaise)} across ${plural(total, "transaction")}: ${automatic} captured automatically, ${total - automatic} added by you or imported.${
          summary.sampleTransactionCount ? ` Includes ${summary.sampleTransactionCount} sample transactions.` : ""
        }`;
  return [
    {
      key: `daily:${day}`,
      kind: "daily_summary",
      severity: "info",
      title: `Summary for ${formatDate(day)}`,
      body,
      href: `/transactions?from=${day}&to=${day}`,
    },
  ];
}

// Re-evaluates every rule for one user and updates their notifications. Called by the worker
// each cycle. If any rule fails nothing is updated, so a failure can never look like a
// condition clearing.
export async function refreshNotifications(db: Database, userId: string, now = new Date()) {
  const desired = (
    await Promise.all([
      connectionRules(db, userId),
      captureRules(db, userId),
      reviewRules(db, userId),
      explainRule(db, userId, now),
      budgetRules(db, userId, now),
      dailySummaryRule(db, userId, now),
    ])
  ).flat();
  await applyNotifications(db, userId, desired, now);
  return desired.length;
}

export async function refreshAllNotifications(db: Database, now = new Date()) {
  const all = await db.select({ id: users.id }).from(users);
  for (const { id } of all) await refreshNotifications(db, id, now);
}
