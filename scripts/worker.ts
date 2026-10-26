// Background worker, every WORKER_POLL_SECONDS: syncs Gmail and processes the ingestion queue,
// updates the Google Sheets copy, then refreshes in-app notifications.
// Safe to stop at any time: queued items stay in the database and are picked up on restart.
//
//   npm run worker
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { env, gmailConfig, sheetsConfig } = await import("../src/server/env");
  const { db, closeDb } = await import("../src/server/db/client");
  const { logger } = await import("../src/server/logger");
  const { runCycle } = await import("../src/server/ingestion/gmail/service");
  const { syncAllSheets } = await import("../src/server/sheets/service");
  const { refreshAllNotifications } = await import("../src/server/notifications/rules");

  // Each step runs even if an earlier one failed: a Gmail outage must not stop notifications.
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      logger.error({ event: "worker_step_failed", step: name, err: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };

  const pollMs = env().WORKER_POLL_SECONDS * 1000;
  let stopping = false;
  let wake: (() => void) | null = null;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  logger.info({ event: "worker_started", pollSeconds: pollMs / 1000 });
  while (!stopping) {
    const started = Date.now();
    // Without Gmail configured the worker still processes queued iPhone Shortcut items.
    const result = await step("capture", () => runCycle(db(), { config: gmailConfig() }));
    if (result && (result.queued || result.processed)) logger.info({ event: "worker_cycle", ...result, ms: Date.now() - started });
    const sheets = await step("sheets", async () => {
      const config = sheetsConfig();
      return config ? syncAllSheets(db(), { config }) : [];
    });
    const synced = sheets?.filter((r) => r.status === "synced").length;
    if (synced) logger.info({ event: "sheets_synced", count: synced });
    await step("notifications", () => refreshAllNotifications(db()));
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, Math.max(1000, pollMs - (Date.now() - started)));
    });
  }
  logger.info({ event: "worker_stopped" });
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
