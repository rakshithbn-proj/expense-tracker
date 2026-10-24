import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import type { Database } from "@/server/db/client";
import { gmailConnections, transactionSources } from "@/server/db/schema";
import type { GmailConfig } from "@/server/env";
import { logger } from "@/server/logger";
import { toAlertEmail } from "../email/gmail-message";
import { gmailSenderQuery, KNOWN_SENDERS, parseAlert } from "../email/registry";
import { recordHealth } from "../health";
import { ingestEvent } from "../ingest";
import { maskExcerpt } from "../mask";
import { processShortcutRow } from "../shortcut/service";
import { claimBatch, completeSource, enqueueSource, purgeExpiredPayloads, retryLater, type SourceRow } from "../queue";
import { GmailAuthError, GmailClient, GmailTransientError, GMAIL_SCOPE, type FetchLike } from "./client";

const SOURCE = { type: "gmail" as const, name: "Gmail" };
const OVERLAP_MS = 2 * 86_400_000;
const MAX_PAGES = 50;
const UNRECOGNIZED_KEEP_MS = 7 * 86_400_000;

export type GmailDeps = { config: GmailConfig; fetchImpl?: FetchLike; now?: () => Date };
// Queue processing also handles non-Gmail items, so it works without Gmail configured.
export type QueueDeps = { config: GmailConfig | null; fetchImpl?: FetchLike; now?: () => Date };
type Connection = typeof gmailConnections.$inferSelect;

export async function getConnection(db: Database, userId: string): Promise<Connection | null> {
  const [row] = await db.select().from(gmailConnections).where(eq(gmailConnections.userId, userId));
  return row ?? null;
}

// Stores a newly authorized connection. Only the encrypted refresh token is kept.
export async function saveConnection(
  db: Database,
  userId: string,
  input: { emailAddress: string; refreshToken: string; scope: string },
  config: GmailConfig,
) {
  if (!input.scope.split(" ").includes(GMAIL_SCOPE)) throw new GmailAuthError("Gmail read access was not granted");
  const values = {
    emailAddress: input.emailAddress,
    refreshTokenEncrypted: encryptSecret(input.refreshToken, config.encryptionKey),
    scope: input.scope,
    status: "connected" as const,
    lastError: null,
    updatedAt: new Date(),
  };
  await db
    .insert(gmailConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: gmailConnections.userId, set: values });
  await recordAudit(db, { userId, entityType: "gmail_connection", entityId: userId, action: "connect" });
}

// Revokes Google's grant and deletes the stored token. Captured transactions stay.
export async function disconnect(db: Database, userId: string, deps: GmailDeps) {
  const conn = await getConnection(db, userId);
  if (!conn) return;
  if (conn.refreshTokenEncrypted) {
    try {
      await GmailClient.revoke(decryptSecret(conn.refreshTokenEncrypted, deps.config.encryptionKey), deps.fetchImpl);
    } catch (err) {
      logger.warn({ event: "gmail_revoke_failed", err: err instanceof Error ? err.message : String(err) });
    }
  }
  await db
    .update(gmailConnections)
    .set({ refreshTokenEncrypted: null, status: "disconnected", updatedAt: new Date() })
    .where(eq(gmailConnections.userId, userId));
  await recordHealth(db, userId, SOURCE, { ok: false, code: "disconnected", status: "not_configured" });
  await recordAudit(db, { userId, entityType: "gmail_connection", entityId: userId, action: "disconnect" });
}

function clientFor(conn: Connection, deps: GmailDeps): GmailClient {
  if (!conn.refreshTokenEncrypted) throw new GmailAuthError("No stored Gmail authorization");
  const { clientId, clientSecret, redirectUri } = deps.config;
  return new GmailClient({ clientId, clientSecret, redirectUri }, decryptSecret(conn.refreshTokenEncrypted, deps.config.encryptionKey), deps.fetchImpl);
}

async function markNeedsReauth(db: Database, userId: string, message: string) {
  await db.update(gmailConnections).set({ status: "needs_reauth", lastError: message.slice(0, 300), updatedAt: new Date() }).where(eq(gmailConnections.userId, userId));
  await recordHealth(db, userId, SOURCE, { ok: false, code: "authorization_failed", status: "awaiting_authorization" });
}

// Finds alert emails since the last successful sync (with a 2-day overlap, so downtime and
// Gmail search-index lag are both covered) and queues each one exactly once.
export async function syncGmail(db: Database, userId: string, deps: GmailDeps): Promise<{ queued: number; scanned: number }> {
  const now = deps.now?.() ?? new Date();
  const conn = await getConnection(db, userId);
  if (!conn || conn.status !== "connected") return { queued: 0, scanned: 0 };
  await db.update(gmailConnections).set({ lastSyncStartedAt: now }).where(eq(gmailConnections.userId, userId));

  const since = conn.lastSyncAt
    ? new Date(conn.lastSyncAt.getTime() - OVERLAP_MS)
    : new Date(now.getTime() - deps.config.backfillDays * 86_400_000);
  const q = `${gmailSenderQuery()} after:${Math.floor(since.getTime() / 1000)}`;

  try {
    const client = clientFor(conn, deps);
    let pageToken: string | undefined;
    let queued = 0;
    let scanned = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await client.listMessages(q, pageToken);
      for (const m of res.messages ?? []) {
        scanned++;
        if (await enqueueSource(db, { userId, sourceType: "gmail", sourceIdentifier: conn.emailAddress, sourceMessageId: m.id }, now)) queued++;
      }
      pageToken = res.nextPageToken;
      if (!pageToken) break;
    }
    await db
      .update(gmailConnections)
      .set({ lastSyncAt: now, lastError: null, backfillCompletedAt: conn.backfillCompletedAt ?? now, updatedAt: now })
      .where(eq(gmailConnections.userId, userId));
    await recordHealth(db, userId, SOURCE, { ok: true }, now);
    return { queued, scanned };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof GmailAuthError) await markNeedsReauth(db, userId, message);
    else {
      await db.update(gmailConnections).set({ lastError: message.slice(0, 300), updatedAt: now }).where(eq(gmailConnections.userId, userId));
      await recordHealth(db, userId, SOURCE, { ok: false, code: err instanceof GmailTransientError ? "temporarily_failing" : "sync_error" }, now);
    }
    logger.warn({ event: "gmail_sync_failed", transient: err instanceof GmailTransientError, err: message });
    return { queued: 0, scanned: 0 };
  }
}

export { maskExcerpt };

async function processGmailRow(db: Database, row: SourceRow, client: GmailClient, now: Date) {
  const message = await client.getMessage(row.sourceMessageId!, "full");
  const email = toAlertEmail(message);
  const base = {
    receivedAt: Number.isNaN(email.receivedAt.getTime()) ? null : email.receivedAt,
    rawPayloadHash: createHash("sha256").update(email.text).digest("hex"),
  };
  if (!KNOWN_SENDERS.has(email.fromAddress)) {
    await completeSource(db, row.id, { ...base, parseStatus: "not_transaction", payload: null, errorCode: "unknown_sender" }, now);
    return;
  }
  if (!email.authentication.verified) {
    // Looks like it's from a bank, but Gmail couldn't confirm it: never create a transaction from it.
    await completeSource(
      db,
      row.id,
      {
        ...base,
        parseStatus: "unrecognized",
        errorCode: "unauthenticated_sender",
        lastError: `Sender not verified (${email.authentication.detail}); not recorded`,
        payload: { from: email.fromAddress, subject: email.subject, excerpt: maskExcerpt(email.text) },
        purgePayloadAfter: new Date(now.getTime() + UNRECOGNIZED_KEEP_MS),
      },
      now,
    );
    return;
  }
  const result = parseAlert(email);
  if (result.kind === "transaction") {
    const { parserId, ...event } = result.alert;
    const ingested = await ingestEvent(db, row.userId, event, { captureMethod: "auto_email", deduplicationKey: `gmail:${row.sourceMessageId}` });
    await completeSource(
      db,
      row.id,
      {
        ...base,
        parseStatus: "parsed",
        parserId,
        transactionId: ingested.transactionId,
        matchStatus: ingested.matchStatus,
        errorCode: null,
        lastError: null,
        // Only what's needed to show provenance; the body is not kept.
        payload: { from: email.fromAddress, subject: email.subject },
        purgePayloadAfter: null,
      },
      now,
    );
  } else if (result.kind === "unrecognized") {
    await completeSource(
      db,
      row.id,
      {
        ...base,
        parseStatus: "unrecognized",
        errorCode: "no_template",
        lastError: result.reason,
        payload: { from: email.fromAddress, subject: email.subject, excerpt: maskExcerpt(email.text) },
        purgePayloadAfter: new Date(now.getTime() + UNRECOGNIZED_KEEP_MS),
      },
      now,
    );
  } else {
    await completeSource(db, row.id, { ...base, parseStatus: "not_transaction", payload: null, errorCode: null, lastError: result.reason }, now);
  }
}

// Processes queued Gmail items. Each item is independent: one failure never blocks the rest.
export async function processQueue(db: Database, deps: QueueDeps, limit = 25): Promise<{ processed: number; failed: number }> {
  const now = deps.now?.() ?? new Date();
  const rows = await claimBatch(db, limit, now);
  const clients = new Map<string, GmailClient | null>();
  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.sourceType === "shortcut") {
      try {
        await processShortcutRow(db, row, undefined, now);
        processed++;
      } catch (err) {
        failed++;
        await retryLater(db, row, "processing_error", err instanceof Error ? err.message : String(err), now);
      }
      continue;
    }
    if (row.sourceType !== "gmail") {
      await retryLater(db, row, "no_processor", "No processor for this source yet", now);
      continue;
    }
    try {
      if (!clients.has(row.userId)) {
        const conn = deps.config ? await getConnection(db, row.userId) : null;
        clients.set(row.userId, conn && conn.status === "connected" ? clientFor(conn, { ...deps, config: deps.config! }) : null);
      }
      const client = clients.get(row.userId);
      if (!client) {
        // Not connected right now: keep the item and try again later without using up attempts.
        await retryLater(db, row, "not_connected", "Gmail is not connected", now, false);
        continue;
      }
      await processGmailRow(db, row, client, now);
      processed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof GmailAuthError) {
        await markNeedsReauth(db, row.userId, message);
        clients.set(row.userId, null);
        await retryLater(db, row, "authorization_failed", message, now, false);
      } else if (err instanceof GmailTransientError) {
        await retryLater(db, row, "temporarily_failing", message, now);
      } else if (/Gmail API 404/.test(message)) {
        await completeSource(db, row.id, { parseStatus: "failed", errorCode: "message_gone", lastError: "The email no longer exists in Gmail" }, now);
      } else {
        logger.error({ event: "ingest_error", sourceId: row.id, err: message });
        await retryLater(db, row, "processing_error", message, now);
      }
    }
  }
  return { processed, failed };
}

// One worker cycle: sync every connected Gmail account (when configured), drain the queue,
// purge expired excerpts.
export async function runCycle(db: Database, deps: QueueDeps) {
  let queued = 0;
  if (deps.config) {
    const gmail = { ...deps, config: deps.config };
    const connected = await db.select({ userId: gmailConnections.userId }).from(gmailConnections).where(eq(gmailConnections.status, "connected"));
    for (const { userId } of connected) queued += (await syncGmail(db, userId, gmail)).queued;
  }
  let processed = 0;
  for (let i = 0; i < 20; i++) {
    const r = await processQueue(db, deps);
    processed += r.processed;
    if (r.processed + r.failed === 0) break;
  }
  await purgeExpiredPayloads(db);
  return { queued, processed };
}

export async function sourceForTransaction(db: Database, userId: string, transactionId: string) {
  return db
    .select()
    .from(transactionSources)
    .where(and(eq(transactionSources.userId, userId), eq(transactionSources.transactionId, transactionId)));
}
