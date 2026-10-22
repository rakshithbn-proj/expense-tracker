"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { formString, runAction, rupeesToPaise } from "@/server/action-result";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { removeBudget, setBudget } from "@/server/finance/budgets-service";

const categoryFrom = (fd: FormData) => formString(fd, "categoryId") || null;

export async function setBudgetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    const warn = Number(formString(fd, "warnAtPercent") || 80);
    await setBudget(db(), user.id, {
      categoryId: categoryFrom(fd),
      fromMonth: formString(fd, "fromMonth") ?? "",
      limitPaise: rupeesToPaise(formString(fd, "limit")),
      warnAtPercent: Number.isInteger(warn) ? warn : 80,
    });
    revalidatePath("/", "layout");
    return "Budget saved.";
  });
}

export async function removeBudgetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    await removeBudget(db(), user.id, categoryFrom(fd));
    revalidatePath("/", "layout");
    return "Budget removed.";
  });
}
