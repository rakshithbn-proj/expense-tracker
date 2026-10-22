import "server-only";
import type { Executor } from "@/server/finance/db-types";
import { auditEvents } from "@/server/db/schema";

export async function recordAudit(
  database: Executor,
  event: {
    userId: string | null;
    entityType: string;
    entityId?: string | null;
    action: string;
    metadata?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await database.insert(auditEvents).values({
    userId: event.userId,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    action: event.action,
    metadata: event.metadata ?? {},
  });
}
