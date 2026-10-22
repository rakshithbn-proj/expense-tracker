// Starts the local development database and keeps it running until Ctrl+C.
import path from "node:path";
import { startEmbeddedPg } from "./lib/embedded-pg";

async function main() {
  const pg = await startEmbeddedPg({
    dataDir: path.resolve(".data/postgres"),
    port: 5433,
    persistent: true,
    database: "expense_tracker",
    quiet: true,
  });
  console.log(`PostgreSQL 18 running: ${pg.connectionString.replace(/:[^:@]+@/, ":***@")}`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
