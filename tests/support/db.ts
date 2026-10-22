import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { inject } from "vitest";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/client";

let pool: Pool | undefined;

export function testDb(): Database {
  pool ??= new Pool({ connectionString: inject("databaseUrl"), max: 4 });
  return drizzle(pool, { schema });
}

export async function resetDb(): Promise<void> {
  const { rows } = await testDb().execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await testDb().execute(sql.raw(`truncate ${list} restart identity cascade`));
}

export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
