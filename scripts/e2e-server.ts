// Playwright's web server: throwaway database + seeded owner + `next start` (needs a prior `next build`).
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { startEmbeddedPg } from "./lib/embedded-pg";
import { runMigrations } from "../src/server/db/migrate";

export const E2E_EMAIL = "e2e@example.com";
export const E2E_PASSWORD = "e2e-password-123456";
const PORT = process.env.E2E_PORT ?? "3100";

// Playwright kills this process hard on Windows, so the shutdown handler may not run.
// Remove data directories left by earlier runs instead.
function removeStaleDataDirs() {
  const root = path.resolve(".data");
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    if (name.startsWith("e2e-pg-")) rmSync(path.join(root, name), { recursive: true, force: true });
  }
}

async function main() {
  removeStaleDataDirs();
  const dataDir = path.resolve(`.data/e2e-pg-${process.pid}`);
  const pg = await startEmbeddedPg({ dataDir, port: 5435, persistent: false, database: "expense_tracker_e2e", quiet: true });
  await runMigrations(pg.connectionString);

  process.env.DATABASE_URL = pg.connectionString;
  const { db, closeDb } = await import("../src/server/db/client");
  const { createOwner } = await import("../src/server/users");
  await createOwner(db(), E2E_EMAIL, E2E_PASSWORD);
  await closeDb();

  const next = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "-p", PORT], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: pg.connectionString,
      APP_ORIGIN: `http://localhost:${PORT}`,
      LOG_LEVEL: "warn",
      // Never use the developer's real Google credentials from .env.local: values set here take
      // precedence over .env files, and empty means "not configured".
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      TOKEN_ENCRYPTION_KEY: "",
    },
  });

  const shutdown = async () => {
    next.kill();
    await pg.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  next.on("exit", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
