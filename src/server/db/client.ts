import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/server/env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

// Reuse one pool across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { pool?: Pool; db?: Database };

export function db(): Database {
  if (!globalForDb.db) {
    globalForDb.pool = new Pool({ connectionString: env().DATABASE_URL, max: 10 });
    globalForDb.db = drizzle(globalForDb.pool, { schema });
  }
  return globalForDb.db;
}

export async function closeDb(): Promise<void> {
  await globalForDb.pool?.end();
  globalForDb.pool = undefined;
  globalForDb.db = undefined;
}
