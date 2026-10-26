"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { formString, runAction } from "@/server/action-result";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { dismiss, markRead } from "@/server/notifications/service";

const done = (message: string) => {
  revalidatePath("/", "layout");
  return message;
};

export async function markReadAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    const id = formString(fd, "id");
    await markRead(db(), user.id, id ?? "all");
    return done(id ? "Marked as read." : "All marked as read.");
  });
}

export async function dismissAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    await dismiss(db(), user.id, formString(fd, "id")!);
    return done("Dismissed.");
  });
}
