import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

// Public liveness check for Docker and uptime monitors. It reports only up/down,
// never counts, timestamps or any financial data.
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logger.error({ event: "health_db_unavailable", err: err instanceof Error ? err.message : String(err) });
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
