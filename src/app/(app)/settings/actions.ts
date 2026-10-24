"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/finance-types";
import { formString, runAction } from "@/server/action-result";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { DomainError, NotFoundError } from "@/server/errors";
import { createAccount, updateAccount } from "@/server/finance/accounts-service";
import { createCategory, updateCategory } from "@/server/finance/categories-service";
import { setRuleActive } from "@/server/finance/rules-service";
import { env } from "@/server/env";
import { createDeviceKey, revokeDeviceKey } from "@/server/ingestion/shortcut/keys";
import type { KeyState } from "./device-keys";

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

export async function createDeviceKeyAction(_prev: KeyState, fd: FormData): Promise<KeyState> {
  const user = await requireUser();
  try {
    const { key } = await createDeviceKey(db(), user.id, formString(fd, "name") ?? "");
    revalidatePath("/settings");
    return { error: null, key, endpoint: new URL("/api/ingest/shortcut", env().APP_ORIGIN).toString() };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, key: null, endpoint: null };
    throw err;
  }
}

export async function revokeDeviceKeyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    try {
      await revokeDeviceKey(db(), user.id, formString(fd, "id")!);
    } catch (err) {
      if (err instanceof NotFoundError) throw new DomainError("not_found", "That key is already revoked.");
      throw err;
    }
    return done("Key revoked. Shortcuts using it stop working immediately.");
  });
}
