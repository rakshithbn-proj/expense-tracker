"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { formString, runAction } from "@/server/action-result";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { gmailConfig } from "@/server/env";
import { DomainError } from "@/server/errors";
import { disconnect, processQueue, syncGmail } from "@/server/ingestion/gmail/service";
import { resetForRetry } from "@/server/ingestion/queue";

function config() {
  const c = gmailConfig();
  if (!c) throw new DomainError("not_configured", "Gmail isn't configured on the server yet. See docs/setup/gmail.md.");
  return c;
}

// Runs a sync immediately instead of waiting for the worker's next cycle.
export async function syncNowAction(): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    const deps = { config: config() };
    const { queued, scanned } = await syncGmail(db(), user.id, deps);
    let processed = 0;
    for (let i = 0; i < 10; i++) {
      const r = await processQueue(db(), deps);
      processed += r.processed;
      if (r.processed + r.failed === 0) break;
    }
    revalidatePath("/", "layout");
    return `Checked ${scanned} alert email${scanned === 1 ? "" : "s"}: ${queued} new, ${processed} processed.`;
  });
}

export async function disconnectGmailAction(): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    await disconnect(db(), user.id, { config: config() });
    revalidatePath("/", "layout");
    return "Disconnected, and access revoked at Google. Transactions already captured are kept.";
  });
}

export async function retryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    const id = formString(fd, "id");
    const n = await resetForRetry(db(), user.id, id ? [id] : "all-failed");
    revalidatePath("/automation");
    return n === 0 ? "Nothing to retry." : `${n} item${n === 1 ? "" : "s"} queued again; the worker picks them up within a minute.`;
  });
}
