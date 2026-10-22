"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/finance-types";
import { formString, runAction } from "@/server/action-result";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { createAccount, updateAccount } from "@/server/finance/accounts-service";
import { createCategory, updateCategory } from "@/server/finance/categories-service";
import { setRuleActive } from "@/server/finance/rules-service";

const done = (message: string) => {
  revalidatePath("/", "layout");
  return message;
};

export async function addAccountAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    const type = formString(fd, "accountType") as AccountType;
    if (!ACCOUNT_TYPES.includes(type)) throw new DomainError("invalid_type", "Choose an account type.");
    await createAccount(db(), user.id, {
      institutionName: formString(fd, "institutionName") ?? "",
      accountName: formString(fd, "accountName") ?? "",
      accountType: type,
      maskedIdentifier: formString(fd, "maskedIdentifier") || null,
    });
    return done("Account added.");
  });
}

export async function toggleAccountAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    const active = formString(fd, "isActive") === "true";
    await updateAccount(db(), user.id, formString(fd, "id")!, { isActive: active });
    return done(active ? "Account reactivated." : "Account hidden from new entries.");
  });
}

export async function addCategoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    await createCategory(db(), user.id, { name: formString(fd, "name") ?? "" });
    return done("Category added.");
  });
}

export async function updateCategoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    const isActive = formString(fd, "isActive");
    await updateCategory(db(), user.id, formString(fd, "id")!, {
      name: formString(fd, "name"),
      isActive: isActive === undefined ? undefined : isActive === "true",
    });
    return done("Saved.");
  });
}

export async function toggleRuleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    const active = formString(fd, "isActive") === "true";
    await setRuleActive(db(), user.id, formString(fd, "id")!, active);
    return done(active ? "Rule turned on." : "Rule turned off.");
  });
}
