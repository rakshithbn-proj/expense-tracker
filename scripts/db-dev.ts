// Runs only the local database in this window until Ctrl+C, then shuts it down cleanly.
// For the whole app (database, web app and worker) use `npm run app:start` / `npm run app:stop`.
import { localDatabaseUrl, startPg, stopPg } from "./lib/local-pg";

async function main() {
  const result = await startPg();
  console.log(`PostgreSQL 18 ${result === "started" ? "running" : "was already running"}: ${localDatabaseUrl().replace(/:[^:@]+@/, ":***@")}`);
  console.log("Press Ctrl+C to shut it down cleanly.");

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await stopPg().catch((err) => console.error(err instanceof Error ? err.message : err));
    console.log("Database shut down cleanly.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  setInterval(() => {}, 1 << 30); // keep the process alive until Ctrl+C
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
