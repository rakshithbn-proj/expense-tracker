import { loadEnvConfig } from "@next/env";
import { runMigrations } from "../src/server/db/migrate";

loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

runMigrations(url)
  .then(() => console.log("Migrations applied."))
  .catch((err) => {
    console.error("Migration failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
