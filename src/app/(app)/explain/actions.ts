"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { formString, runAction } from "@/server/action-result";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { explainTransaction } from "@/server/explain/service";

export async function explainAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    await explainTransaction(db(), user.id, formString(fd, "id")!, {
      categoryId: formString(fd, "categoryId") || undefined,
      reason: formString(fd, "reason") ?? null,
      remember: formString(fd, "remember") === "on",
    });
    revalidatePath("/", "layout");
    return "Saved.";
  });
}
