import "server-only";
import { createHash } from "node:crypto";
import { and, count, eq, isNull, max } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import type { Database } from "@/server/db/client";
import { categories, financialAccounts, sheetsConnections, transactions } from "@/server/db/schema";
import type { SheetsConfig } from "@/server/env";
import { transactionTable, TRANSACTION_HEADERS, type Cell } from "@/server/export/table";
import { columnName } from "@/server/export/xlsx";
import { lookups } from "@/server/finance/reports-service";
import { allMatchingTransactions } from "@/server/finance/transactions-service";
import { GoogleAuthError, revokeGoogleToken, type FetchLike } from "@/server/google/oauth";
import { backoffMs } from "@/server/ingestion/queue";
import { logger } from "@/server/logger";
import { SheetsClient, SpreadsheetNotFoundError, SHEETS_SCOPE, type SheetValue, type Spreadsheet } from "./client";

export const SHEET_TITLE = "Transactions";
const SPREADSHEET_TITLE = "Expense tracker";
// Bump when the columns change, so every connected sheet is rewritten with the new layout.
const LAYOUT_VERSION = 2; // 2: added the "Why" column
const WRITE_CHUNK_ROWS = 2000;

export type SheetsDeps = { config: SheetsConfig; fetchImpl?: FetchLike; now?: () => Date };
type Connection = typeof sheetsConnections.$inferSelect;
export type SyncResult = { status: "synced"; rows: number } | { status: "unchanged" } | { status: "skipped"; reason: string } | { status: "failed"; error: string };

export async function getSheetsConnection(db: Database, userId: string): Promise<Connection | null> {
  const [row] = await db.select().from(sheetsConnections).where(eq(sheetsConnections.userId, userId));
  return row ?? null;
}

// Stores a new grant. Reconnecting the same Google account keeps the same spreadsheet (the next
// sync rewrites it in full); switching to another account starts a new spreadsheet there.
export async function saveSheetsConnection(
  db: Database,
  userId: string,
  input: { refreshToken: string; scope: string; emailAddress: string | null },
  config: SheetsConfig,
  now = new Date(),
) {
  if (!input.scope.split(" ").includes(SHEETS_SCOPE)) throw new GoogleAuthError("Access to the app's spreadsheet was not granted");
  const previous = await getSheetsConnection(db, userId);
  const accountChanged = !!previous?.spreadsheetId && previous.emailAddress !== input.emailAddress;
  const values = {
    refreshTokenEncrypted: encryptSecret(input.refreshToken, config.encryptionKey),
    scope: input.scope,
    emailAddress: input.emailAddress,
    ...(accountChanged ? { spreadsheetId: null, spreadsheetUrl: null, syncedRowCount: null, lastSyncAt: null } : {}),
    status: "connected" as const,
    syncedFingerprint: null,
    consecutiveFailures: 0,
    nextAttemptAt: null,
    lastError: null,
    updatedAt: now,
  };
  await db.insert(sheetsConnections).values({ userId, ...values }).onConflictDoUpdate({ target: sheetsConnections.userId, set: values });
  await recordAudit(db, { userId, entityType: "sheets_connection", entityId: userId, action: "connect", metadata: { accountChanged } });
}

// Revokes Google's grant and forgets the token. The spreadsheet itself stays in the user's Drive.
export async function disconnectSheets(db: Database, userId: string, deps: SheetsDeps) {
  const conn = await getSheetsConnection(db, userId);
  if (!conn) return;
  if (conn.refreshTokenEncrypted) {
    try {
      await revokeGoogleToken(decryptSecret(conn.refreshTokenEncrypted, deps.config.encryptionKey), deps.fetchImpl);
    } catch (err) {
      logger.warn({ event: "sheets_revoke_failed", err: err instanceof Error ? err.message : String(err) });
    }
  }
  await db
    .update(sheetsConnections)
    .set({ refreshTokenEncrypted: null, status: "disconnected", nextAttemptAt: null, updatedAt: new Date() })
    .where(eq(sheetsConnections.userId, userId));
  await recordAudit(db, { userId, entityType: "sheets_connection", entityId: userId, action: "disconnect" });
}

// Changes whenever anything shown in the sheet changes: a transaction added, corrected or
// voided, or a category or account renamed. Sample data is never synced.
async function dataFingerprint(db: Database, userId: string): Promise<string> {
  const [[tx], [cat], [acc]] = await Promise.all([
    db
      .select({ n: count(), last: max(transactions.updatedAt) })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.voidedAt), eq(transactions.isSample, false))),
    db.select({ n: count(), last: max(categories.updatedAt) }).from(categories).where(eq(categories.userId, userId)),
    db.select({ n: count(), last: max(financialAccounts.updatedAt) }).from(financialAccounts).where(eq(financialAccounts.userId, userId)),
  ]);
  const parts = [LAYOUT_VERSION, tx.n, tx.last?.toISOString(), cat.n, cat.last?.toISOString(), acc.n, acc.last?.toISOString()];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

const toValue = (cell: Cell): SheetValue => (cell === null ? "" : cell.t === "n" ? Number(cell.v) : cell.v);

async function ensureSpreadsheet(db: Database, conn: Connection, client: SheetsClient, now: Date): Promise<{ spreadsheet: Spreadsheet; sheetId: number }> {
  let spreadsheet: Spreadsheet | null = null;
  if (conn.spreadsheetId) {
    try {
      spreadsheet = await client.get(conn.spreadsheetId);
    } catch (err) {
      if (!(err instanceof SpreadsheetNotFoundError)) throw err;
      logger.warn({ event: "sheets_spreadsheet_missing" });
    }
  }
  if (!spreadsheet) {
    spreadsheet = await client.create(SPREADSHEET_TITLE, SHEET_TITLE);
    // Saved straight away, so a failure later in this sync never leads to a second spreadsheet.
    await db
      .update(sheetsConnections)
      .set({ spreadsheetId: spreadsheet.spreadsheetId, spreadsheetUrl: spreadsheet.spreadsheetUrl, syncedFingerprint: null, updatedAt: now })
      .where(eq(sheetsConnections.id, conn.id));
  }
  const tab = spreadsheet.sheets?.find((s) => s.properties.title === SHEET_TITLE);
  if (tab) return { spreadsheet, sheetId: tab.properties.sheetId };
  // The user deleted or renamed the tab: add it back.
  const res = await client.batchUpdate(spreadsheet.spreadsheetId, [{ addSheet: { properties: { title: SHEET_TITLE, gridProperties: { frozenRowCount: 1 } } } }]);
  const added = res.replies?.[0]?.addSheet?.properties;
  if (!added) throw new Error("Google Sheets didn't confirm the new tab");
  return { spreadsheet, sheetId: added.sheetId };
}

// Makes the Transactions tab an exact copy of the current data: one row per transaction ID,
// newest first. Rewriting it in full is idempotent, so a retry after any failure (or two syncs
// at once) can never duplicate or lose rows.
async function writeSheet(db: Database, userId: string, conn: Connection, client: SheetsClient, now: Date): Promise<number> {
  const [items, names] = await Promise.all([allMatchingTransactions(db, userId, { sort: "date", order: "desc" }), lookups(db, userId)]);
  const table = transactionTable(
    items.filter((t) => !t.isSample),
    names,
  );
  const { spreadsheet, sheetId } = await ensureSpreadsheet(db, conn, client, now);
  const id = spreadsheet.spreadsheetId;
  const rows = table.rows.length;
  const lastColumn = columnName(TRANSACTION_HEADERS.length - 1);

  // Exactly one header row plus one row per transaction: shrinking removes rows left over from a
  // longer previous sync. At least 2 rows, because a sheet can't freeze all of its rows.
  await client.batchUpdate(id, [
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { rowCount: Math.max(rows + 1, 2), columnCount: TRANSACTION_HEADERS.length, frozenRowCount: 1 } },
        fields: "gridProperties(rowCount,columnCount,frozenRowCount)",
      },
    },
  ]);
  const values: SheetValue[][] = [table.headers, ...table.rows.map((r) => r.map(toValue))];
  for (let start = 0; start < values.length; start += WRITE_CHUNK_ROWS) {
    const chunk = values.slice(start, start + WRITE_CHUNK_ROWS);
    await client.updateValues(id, `${SHEET_TITLE}!A${start + 1}:${lastColumn}${start + chunk.length}`, chunk);
  }
  if (rows === 0) await client.clearValues(id, `${SHEET_TITLE}!A2:${lastColumn}2`);
  return rows;
}

// Syncs one user's sheet if the data changed since the last successful sync. Failures back off
// exponentially (2 min up to 6 h); `force` (the "Sync now" button) ignores both checks.
export async function syncSheets(db: Database, userId: string, deps: SheetsDeps, options: { force?: boolean } = {}): Promise<SyncResult> {
  const now = deps.now?.() ?? new Date();
  const conn = await getSheetsConnection(db, userId);
  if (!conn || conn.status !== "connected" || !conn.refreshTokenEncrypted) return { status: "skipped", reason: "not_connected" };
  if (!options.force && conn.nextAttemptAt && conn.nextAttemptAt > now) return { status: "skipped", reason: "backing_off" };

  const fingerprint = await dataFingerprint(db, userId);
  if (!options.force && conn.spreadsheetId && conn.syncedFingerprint === fingerprint) return { status: "unchanged" };

  const { clientId, clientSecret, redirectUri } = deps.config;
  const client = new SheetsClient({ clientId, clientSecret, redirectUri }, decryptSecret(conn.refreshTokenEncrypted, deps.config.encryptionKey), deps.fetchImpl);
  try {
    const rows = await writeSheet(db, userId, conn, client, now);
    await db
      .update(sheetsConnections)
      .set({
        syncedFingerprint: fingerprint,
        syncedRowCount: rows,
        lastSyncAt: now,
        lastAttemptAt: now,
        nextAttemptAt: null,
        consecutiveFailures: 0,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(sheetsConnections.id, conn.id));
    return { status: "synced", rows };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    const failures = conn.consecutiveFailures + 1;
    await db
      .update(sheetsConnections)
      .set({
        ...(err instanceof GoogleAuthError ? { status: "needs_reauth" as const, nextAttemptAt: null } : { nextAttemptAt: new Date(now.getTime() + backoffMs(failures)) }),
        consecutiveFailures: failures,
        lastAttemptAt: now,
        lastError: message,
        updatedAt: now,
      })
      .where(eq(sheetsConnections.id, conn.id));
    logger.warn({ event: "sheets_sync_failed", auth: err instanceof GoogleAuthError, failures, err: message });
    return { status: "failed", error: message };
  }
}

export async function syncAllSheets(db: Database, deps: SheetsDeps) {
  const connected = await db.select({ userId: sheetsConnections.userId }).from(sheetsConnections).where(eq(sheetsConnections.status, "connected"));
  const results: SyncResult[] = [];
  for (const { userId } of connected) results.push(await syncSheets(db, userId, deps));
  return results;
}
