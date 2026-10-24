// Background worker: syncs Gmail and processes the ingestion queue every WORKER_POLL_SECONDS.
// Safe to stop at any time: queued items stay in the database and are picked up on restart.
//
//   npm run worker
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { env, gmailConfig } = await import("../src/server/env");
  const { db, closeDb } = await import("../src/server/db/client");
  const { logger } = await import("../src/server/logger");
  const { runCycle } = await import("../src/server/ingestion/gmail/service");

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
    try {
      // Without Gmail configured the worker still processes queued iPhone Shortcut items.
      const result = await runCycle(db(), { config: gmailConfig() });
      if (result.queued || result.processed) logger.info({ event: "worker_cycle", ...result, ms: Date.now() - started });
    } catch (err) {
      logger.error({ event: "worker_cycle_failed", err: err instanceof Error ? err.message : String(err) });
    }
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
