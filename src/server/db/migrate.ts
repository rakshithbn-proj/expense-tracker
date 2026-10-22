// Used by scripts and tests, outside Next.js, so no server-only import here.
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  } finally {
    await pool.end();
  }
}
