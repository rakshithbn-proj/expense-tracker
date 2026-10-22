// Starts a throwaway real PostgreSQL 18 for the test run and applies all migrations.
import { rmSync } from "node:fs";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { startEmbeddedPg } from "../../scripts/lib/embedded-pg";
import { runMigrations } from "../../src/server/db/migrate";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    serverUrl: string;
  }
}

const PORT = 5434;

export default async function setup(project: TestProject) {
  const dataDir = path.resolve(`.data/test-pg-${process.pid}`);
  rmSync(dataDir, { recursive: true, force: true });

  const pg = await startEmbeddedPg({
    dataDir,
    port: PORT,
    persistent: false,
    database: "expense_tracker_test",
    quiet: true,
  });
  await runMigrations(pg.connectionString);

  project.provide("databaseUrl", pg.connectionString);
  project.provide("serverUrl", pg.connectionString.replace(/\/[^/]+$/, "/postgres"));

  return async () => {
    await pg.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
}
