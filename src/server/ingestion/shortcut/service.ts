import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isValidDate, istDate } from "@/lib/dates";
import { PAYMENT_METHODS } from "@/lib/finance-types";
import { MoneyParseError, parseAmountToPaise } from "@/lib/money";
import type { Database } from "@/server/db/client";
import { transactionSources } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createTransaction } from "@/server/finance/transactions-service";
import { isOtpMessage, looksLikeTransaction } from "../email/parse-helpers";
import { ingestEvent } from "../ingest";
import { maskExcerpt } from "../mask";
import { recordHealth } from "../health";
import { completeSource, enqueueSource, type SourceRow } from "../queue";
import { parseSms } from "../sms/parsers";
import { deviceSourceIdentifier, type AuthenticatedDevice } from "./keys";

const UNRECOGNIZED_KEEP_MS = 7 * 86_400_000;
const SOURCE = { type: "shortcut" as const, name: "iPhone Shortcut" };

const id = z.string().trim().max(100).optional();
const amount = z.union([z.number(), z.string()]).transform((v, ctx) => {
  try {
    const paise = parseAmountToPaise(String(v));
    if (paise > 0) return paise;
  } catch (err) {
    if (!(err instanceof MoneyParseError)) throw err;
  }
  ctx.addIssue({ code: "custom", message: "Enter an amount greater than zero, e.g. 450 or 450.50" });
  return z.NEVER;
});

// What a Shortcut may send. Never ask for, or accept, a UPI PIN, password, CVV or OTP.
export const submissionSchema = z.discriminatedUnion("kind", [
  // Typed by the user in the Shortcut: recorded as manual entry.
  z.object({
    kind: z.literal("quick_add"),
    amount,
    merchant: z.string().trim().max(200).optional(),
    date: z.string().refine(isValidDate, "Use YYYY-MM-DD").optional(),
    direction: z.enum(["debit", "credit"]).default("debit"),
    paymentMethod: z.enum(PAYMENT_METHODS).default("unknown"),
    // Stated by the user, so it's evidence of which app was used.
    paymentApp: z.string().trim().max(60).optional(),
    note: z.string().trim().max(500).optional(),
    id,
  }),
  // A bank SMS forwarded by a Shortcuts automation: automatic capture.
  z.object({ kind: z.literal("sms"), text: z.string().min(1).max(5000), sender: z.string().trim().max(100).optional(), id }),
  // Text from a payment receipt the user shared (often via Extract Text from Image): user-triggered.
  z.object({ kind: z.literal("share"), text: z.string().min(1).max(5000), app: z.string().trim().max(60).optional(), id }),
]);
export type Submission = z.infer<typeof submissionSchema>;

export type SubmitResult = {
  status: "captured" | "duplicate" | "needs_review" | "ignored" | "queued";
  message: string;
  transactionId?: string;
};

// Identifies a submission so sending the same thing twice (a double tap, or an automation firing
// twice for one SMS) never creates a second record. Quick Add without an id is unique per minute.
function submissionKey(s: Submission, now: Date): string {
  if (s.id) return `${s.kind}:id:${s.id}`;
  const content =
    s.kind === "quick_add"
      ? [s.amount, s.merchant ?? "", s.date ?? "", s.direction, Math.floor(now.getTime() / 60_000)].join("|")
      : [s.text.replace(/\s+/g, " ").trim(), s.kind === "sms" ? (s.sender ?? "") : ""].join("|");
  return `${s.kind}:${createHash("sha256").update(content).digest("hex")}`;
}

function resultFor(row: Pick<SourceRow, "parseStatus" | "transactionId" | "lastError">): SubmitResult {
  switch (row.parseStatus) {
    case "parsed":
      return { status: "captured", message: "Saved.", transactionId: row.transactionId ?? undefined };
    case "unrecognized":
      return { status: "needs_review", message: "Received. It couldn't be read automatically, so it's waiting in the app's review list." };
    case "not_transaction":
      return { status: "ignored", message: "Received, but it isn't a completed payment, so nothing was recorded." };
    default:
      return { status: "queued", message: "Received. It will be processed shortly." };
  }
}

export async function submitFromDevice(db: Database, device: AuthenticatedDevice, raw: unknown, now = new Date()): Promise<SubmitResult> {
  const submission = submissionSchema.parse(raw);
  const sourceMessageId = submissionKey(submission, now);
  const payload = submission.kind === "quick_add" ? { kind: "quick_add" } : { kind: submission.kind, sender: submission.kind === "sms" ? submission.sender : undefined, text: submission.text };

  const inserted = await enqueueSource(
    db,
    { userId: device.userId, sourceType: "shortcut", sourceIdentifier: deviceSourceIdentifier(device.keyId), sourceMessageId, receivedAt: now, payload },
    now,
  );
  const [row] = await db
    .select()
    .from(transactionSources)
    .where(and(eq(transactionSources.userId, device.userId), eq(transactionSources.sourceType, "shortcut"), eq(transactionSources.sourceMessageId, sourceMessageId)));
  if (!inserted) return { ...resultFor(row), status: "duplicate", message: "Already received; nothing new was saved." };

  try {
    await processShortcutRow(db, row, submission, now);
  } catch (err) {
    if (err instanceof DomainError) throw err;
    // Kept in the queue; the worker retries it.
    return resultFor(row);
  }
  await recordHealth(db, device.userId, SOURCE, { ok: true }, now);
  const [done] = await db.select().from(transactionSources).where(eq(transactionSources.id, row.id));
  return resultFor(done);
}

// Turns one stored submission into a transaction or a review item. Also used by the worker
// for submissions whose first attempt failed.
export async function processShortcutRow(db: Database, row: SourceRow, given?: Submission, now = new Date()) {
  const submission = given ?? storedSubmission(row);
  if (!submission) {
    // Unrecognised text is kept masked for 7 days only; after that there's nothing to replay.
    await completeSource(db, row.id, { parseStatus: "failed", errorCode: "not_replayable", lastError: "The text is no longer kept; send it again" }, now);
    return;
  }
  if (submission.kind === "quick_add") {
    if (!given) {
      // The amount isn't kept in the stored payload, so a failed Quick Add can't be replayed.
      await completeSource(db, row.id, { parseStatus: "failed", errorCode: "not_replayable", lastError: "Quick Add needs to be sent again" }, now);
      return;
    }
    const { transaction } = await createTransaction(
      db,
      row.userId,
      {
        transactionDate: submission.date ?? istDate(now),
        amountPaise: submission.amount,
        direction: submission.direction,
        transactionType: submission.direction === "debit" ? "purchase" : "income",
        merchantName: submission.merchant ?? null,
        paymentMethod: submission.paymentMethod,
        paymentApp: submission.paymentApp ?? null,
        notes: submission.note ?? null,
        deduplicationKey: `shortcut:${row.sourceMessageId}`,
      },
      { captureMethod: "manual" },
    );
    await completeSource(db, row.id, { parseStatus: "parsed", parserId: "shortcut.quick_add", transactionId: transaction.id, matchStatus: "created", payload: { kind: "quick_add" } }, now);
    return;
  }

  const text = submission.text;
  const subject = submission.kind === "sms" ? (submission.sender ?? "") : "";
  if (isOtpMessage(text, subject)) {
    await completeSource(db, row.id, { parseStatus: "not_transaction", payload: null, lastError: "one-time password, not a completed payment" }, now);
    return;
  }
  const parsed = submission.kind === "sms" ? parseSms(text, row.receivedAt ?? now) : null;
  if (parsed?.kind === "transaction") {
    const { parserId, ...event } = parsed.alert;
    const ingested = await ingestEvent(db, row.userId, event, { captureMethod: "auto_sms", deduplicationKey: `shortcut:${row.sourceMessageId}` });
    await completeSource(
      db,
      row.id,
      {
        parseStatus: "parsed",
        parserId,
        transactionId: ingested.transactionId,
        matchStatus: ingested.matchStatus,
        errorCode: null,
        lastError: null,
        // Only provenance; the SMS text is not kept.
        payload: { kind: submission.kind, sender: subject || undefined },
        purgePayloadAfter: null,
      },
      now,
    );
    return;
  }
  // Formats not seen yet aren't guessed: transaction-like text waits for review (masked), and
  // becomes the sample for a new parser.
  if (parsed?.kind === "unrecognized" || looksLikeTransaction(text, subject)) {
    await completeSource(
      db,
      row.id,
      {
        parseStatus: "unrecognized",
        errorCode: "no_template",
        lastError:
          parsed?.kind === "unrecognized"
            ? parsed.reason
            : `${submission.kind === "sms" ? `SMS${submission.sender ? ` from ${submission.sender}` : ""}` : "Shared receipt"}: no format known yet`,
        payload: { kind: submission.kind, sender: subject || undefined, excerpt: maskExcerpt(text) },
        // A retry doesn't extend how long the excerpt is kept.
        purgePayloadAfter: row.purgePayloadAfter ?? new Date(now.getTime() + UNRECOGNIZED_KEEP_MS),
      },
      now,
    );
    return;
  }
  await completeSource(db, row.id, { parseStatus: "not_transaction", payload: null, lastError: "doesn't look like a payment" }, now);
}

// Rebuilds a submission from what was stored: the full text while it's still queued, or the masked
// excerpt of an unrecognised one (a Retry after a parser was added). Amounts, dates and payees
// survive masking; only long reference numbers don't.
function storedSubmission(row: SourceRow): Submission | null {
  const p = (row.payload ?? {}) as { kind?: string; sender?: string; text?: string; excerpt?: string };
  if (p.kind === "quick_add") return submissionSchema.parse({ kind: "quick_add", amount: 1 });
  const text = p.text ?? p.excerpt;
  if (!text || (p.kind !== "sms" && p.kind !== "share")) return null;
  return submissionSchema.parse(p.kind === "sms" ? { kind: "sms", text, sender: p.sender } : { kind: "share", text });
}
