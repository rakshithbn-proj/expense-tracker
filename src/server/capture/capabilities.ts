import "server-only";
import { and, count, desc, eq, gte, inArray, isNotNull, like, max, or, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { deviceKeys, gmailConnections, sourceHealth, transactionSources, transactions } from "@/server/db/schema";
import { gmailConfig } from "@/server/env";
import { PARSERS } from "@/server/ingestion/email/registry";

// Spec 4.2 statuses. Nothing unsupported or untested is ever shown as operational.
export type CaptureStatus =
  | "Not configured"
  | "Awaiting authorization"
  | "Available for testing"
  | "Tested successfully"
  | "Partially supported"
  | "Unsupported by the current platform"
  | "Temporarily failing"
  | "Not built yet"
  | "Excluded by you";

export type Capability = {
  id: string;
  name: string;
  mechanism: string;
  mode: "Automatic" | "User-triggered" | "Manual";
  permissions: string;
  merchantAndAmount: string;
  reference: string;
  tested: string;
  limitations: string;
  status: CaptureStatus;
  lastSuccessAt: Date | null;
  lastError: string | null;
};

const PARSER_NOTES: Record<string, { merchant: string; reference: string; limitations: string }> = {
  hdfc: {
    merchant: "Card purchases: amount, card, merchant, date and time. RuPay UPI: amount, card, payee UPI ID, date",
    reference: "UPI reference for RuPay UPI payments; none for card purchases",
    limitations: "HDFC bank-account (savings) alerts aren't parsed yet: no sample. They go to the review queue instead of being dropped.",
  },
  hsbc: { merchant: "Amount, card, merchant, date", reference: "None", limitations: "The alert has no time of day, only the date." },
  icici: {
    merchant: "Amount, card, merchant, date and time",
    reference: "None",
    limitations: "ICICI bank-account alerts aren't parsed yet (samples pending).",
  },
  rbl: { merchant: "Amount, card, merchant, date", reference: "None", limitations: "The alert has no time of day, only the date." },
};

export async function captureCapabilities(db: Database, userId: string): Promise<Capability[]> {
  const configured = (() => {
    try {
      return gmailConfig() !== null;
    } catch {
      return false;
    }
  })();
  const [conn] = await db.select().from(gmailConnections).where(eq(gmailConnections.userId, userId));
  const [health] = await db
    .select()
    .from(sourceHealth)
    .where(and(eq(sourceHealth.userId, userId), eq(sourceHealth.sourceType, "gmail")));
  const lastByParser = await db
    .select({ parserId: transactionSources.parserId, last: max(transactionSources.processedAt) })
    .from(transactionSources)
    .where(and(eq(transactionSources.userId, userId), eq(transactionSources.parseStatus, "parsed"), isNotNull(transactionSources.parserId)))
    .groupBy(transactionSources.parserId);

  const activeKeys = await db
    .select({ id: deviceKeys.id })
    .from(deviceKeys)
    .where(and(eq(deviceKeys.userId, userId), sql`${deviceKeys.revokedAt} is null`));
  const lastQuickAdd = lastByParser.find((r) => r.parserId === "shortcut.quick_add")?.last ?? null;
  const shortcutStatus = (built: boolean): CaptureStatus =>
    activeKeys.length === 0 ? "Not configured" : built ? (lastQuickAdd ? "Tested successfully" : "Available for testing") : "Partially supported";

  const gmailStatus = (parserId: string): CaptureStatus => {
    if (!configured) return "Not configured";
    if (!conn || conn.status === "disconnected") return "Awaiting authorization";
    if (conn.status === "needs_reauth") return "Awaiting authorization";
    if (health && health.status === "failing") return "Temporarily failing";
    return lastByParser.some((r) => r.parserId?.startsWith(`${parserId}.`)) ? "Tested successfully" : "Available for testing";
  };

  const gmail: Capability[] = PARSERS.map((p) => {
    const last = lastByParser
      .filter((r) => r.parserId?.startsWith(`${p.id}.`))
      .map((r) => r.last)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      id: `gmail.${p.id}`,
      name: `${p.institutionName} alerts via Gmail`,
      mechanism: "Gmail API (read-only), checked every minute by the background worker",
      mode: "Automatic",
      permissions: "Your Google sign-in with Gmail read-only access",
      merchantAndAmount: PARSER_NOTES[p.id]?.merchant ?? "Amount and merchant",
      reference: PARSER_NOTES[p.id]?.reference ?? "Unknown",
      tested: last
        ? "Parsed real alerts from your connected Gmail"
        : "Parses your real (redacted) sample emails in automated tests; not yet seen from your live Gmail",
      limitations: PARSER_NOTES[p.id]?.limitations ?? "",
      status: gmailStatus(p.id),
      lastSuccessAt: last ?? null,
      lastError: conn?.lastError ?? null,
    };
  });

  const fixed = (c: Omit<Capability, "lastSuccessAt" | "lastError">): Capability => ({ ...c, lastSuccessAt: null, lastError: null });
  return [
    ...gmail,
    fixed({
      id: "gmail.bank_accounts",
      name: "Bank-account alerts (HDFC, ICICI savings) via Gmail",
      mechanism: "Gmail API",
      mode: "Automatic",
      permissions: "Same Gmail access",
      merchantAndAmount: "Unknown until samples are seen",
      reference: "Unknown",
      tested: "No samples yet",
      limitations: "Needed for UPI payments made from bank accounts. Such emails are kept in the review queue until a parser exists.",
      status: "Partially supported",
    }),
    {
      ...fixed({
        id: "iphone.quick_add",
        name: "Quick Add from an iPhone Shortcut",
        mechanism: "A Shortcut asks for amount, payee and app, then sends them to the app",
        mode: "Manual",
        permissions: "A revocable device key in the Shortcut (Settings)",
        merchantAndAmount: "What you type",
        reference: "None",
        tested: lastQuickAdd ? "Used from your phone" : "Automated tests; not yet used from your phone",
        limitations: "Typed by you, so it counts as manual entry, never as automatic capture.",
        status: shortcutStatus(true),
      }),
      lastSuccessAt: lastQuickAdd,
    },
    fixed({
      id: "iphone.sms",
      name: "Bank SMS via iPhone Shortcuts automation",
      mechanism: "Shortcuts “Message” automation forwarding matching SMS to the app",
      mode: "Automatic",
      permissions: "A revocable device key in the Shortcut",
      merchantAndAmount: "Depends on each bank's SMS",
      reference: "Often (UPI reference)",
      tested: "Endpoint tested; not yet tested from your iPhone",
      limitations:
        "Parsed: ICICI Bank account UPI debits. Other SMS are kept (masked) in “Needs a look” and become the samples for new parsers. Whether the automation runs without a tap must be checked on your iPhone.",
      status: shortcutStatus(false),
    }),
    fixed({
      id: "iphone.share",
      name: "UPI app receipt shared to a Shortcut",
      mechanism: "Share sheet → Shortcut (Extract Text from Image) → app",
      mode: "User-triggered",
      permissions: "A revocable device key in the Shortcut",
      merchantAndAmount: "From the shared receipt",
      reference: "UPI transaction ID if visible",
      tested: "Endpoint tested; not yet tested from your iPhone",
      limitations:
        "Needs a tap after paying. Receipt text is kept (masked) for review until a PhonePe or Google Pay receipt format has been seen and a parser added.",
      status: shortcutStatus(false),
    }),
    fixed({
      id: "upi.notifications",
      name: "Reading PhonePe / Google Pay notifications",
      mechanism: "None available",
      mode: "Automatic",
      permissions: "—",
      merchantAndAmount: "—",
      reference: "—",
      tested: "Researched (Apple documentation)",
      limitations: "iOS gives Shortcuts no way to read another app's notifications. Not simulated.",
      status: "Unsupported by the current platform",
    }),
    fixed({
      id: "statements",
      name: "Bank and card statement import (CSV)",
      mechanism: "Upload in the app",
      mode: "Manual",
      permissions: "None",
      merchantAndAmount: "From the statement",
      reference: "Sometimes",
      tested: "Not built",
      limitations: "Built in Milestone 6. Finds missed transactions and measures coverage; never counted as automatic.",
      status: "Not built yet",
    }),
    fixed({
      id: "manual",
      name: "Manual entry",
      mechanism: "Form in the app",
      mode: "Manual",
      permissions: "None",
      merchantAndAmount: "What you enter",
      reference: "None",
      tested: "Automated tests",
      limitations: "Fallback only; never counted as automatic capture.",
      status: "Tested successfully",
    }),
    fixed({
      id: "excluded",
      name: "SBI and American Express",
      mechanism: "—",
      mode: "Automatic",
      permissions: "—",
      merchantAndAmount: "—",
      reference: "—",
      tested: "—",
      limitations: "Left out at your request. Can be added later with sample alerts.",
      status: "Excluded by you",
    }),
  ];
}

const retryingAfterError = and(eq(transactionSources.parseStatus, "pending"), isNotNull(transactionSources.errorCode));

// Queue state, problem items and latency for the Automation page.
export async function ingestionOverview(db: Database, userId: string, now = new Date()) {
  const counts = await db
    .select({ status: transactionSources.parseStatus, n: count() })
    .from(transactionSources)
    .where(eq(transactionSources.userId, userId))
    .groupBy(transactionSources.parseStatus);

  // Includes items waiting to retry after an error, so they're visible and can be retried now.
  const problems = await db
    .select()
    .from(transactionSources)
    .where(and(eq(transactionSources.userId, userId), or(inArray(transactionSources.parseStatus, ["unrecognized", "failed"]), retryingAfterError)))
    .orderBy(desc(transactionSources.updatedAt))
    .limit(50);

  const recent = await db
    .select({ source: transactionSources, merchant: transactions.merchantName, amount: transactions.amount, direction: transactions.direction })
    .from(transactionSources)
    .innerJoin(transactions, eq(transactions.id, transactionSources.transactionId))
    .where(and(eq(transactionSources.userId, userId), eq(transactionSources.parseStatus, "parsed")))
    .orderBy(desc(transactionSources.processedAt))
    .limit(10);

  // Latency over the last 30 days, split into source delivery and app processing (spec 2, 12).
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [latency] = await db
    .select({
      total: count(),
      within5: sql<number>`count(*) filter (where ${transactionSources.processedAt} - ${transactionSources.receivedAt} <= interval '5 minutes')`.mapWith(Number),
      medianProcessingSec: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from ${transactionSources.processedAt} - ${transactionSources.receivedAt}))`.mapWith((v) => (v === null ? null : Number(v))),
      withTime: sql<number>`count(${transactions.sourceTimestamp})`.mapWith(Number),
      medianDeliverySec: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from ${transactionSources.receivedAt} - ${transactions.sourceTimestamp}))`.mapWith((v) => (v === null ? null : Number(v))),
    })
    .from(transactionSources)
    .innerJoin(transactions, eq(transactions.id, transactionSources.transactionId))
    .where(
      and(
        eq(transactionSources.userId, userId),
        eq(transactionSources.parseStatus, "parsed"),
        eq(transactionSources.matchStatus, "created"),
        isNotNull(transactionSources.receivedAt),
        gte(transactionSources.receivedAt, since),
        like(transactionSources.parserId, "%.%"),
      ),
    );

  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<string, number>>,
    problems,
    recent,
    latency,
  };
}
