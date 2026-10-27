"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { formNullable, formString, runAction, rupeesToPaise } from "@/server/action-result";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import {
  correctTransaction,
  createTransaction,
  linkRefund,
  linkReversal,
  linkTransfer,
  unlinkTransaction,
  voidTransaction,
} from "@/server/finance/transactions-service";

// Every action re-authorizes; the services check that the records belong to this user.

export async function correctAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    const id = formString(fd, "id")!;
    const reason = formNullable(fd, "reason");
    const { ruleId } = await correctTransaction(db(), user.id, id, {
      categoryId: formNullable(fd, "categoryId"),
      merchantName: formNullable(fd, "merchantName"),
      transactionType: (formString(fd, "transactionType") || undefined) as never,
      paymentMethod: (formString(fd, "paymentMethod") || undefined) as never,
      financialAccountId: formNullable(fd, "financialAccountId"),
      notes: formNullable(fd, "notes"),
      reason,
      // Giving a reason here answers the iPhone prompt too, so it isn't asked again.
      markExplained: reason ? true : undefined,
      markReviewed: fd.get("markReviewed") === "on",
      createRule: fd.get("createRule") === "on",
    });
    revalidatePath("/", "layout");
    return ruleId ? "Saved. Future transactions from this merchant will use this category." : "Saved.";
  });
}

export async function linkAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    const id = formString(fd, "id")!;
    const targetId = formString(fd, "targetId")!;
    const kind = formString(fd, "kind");
    if (kind === "refund") await linkRefund(db(), user.id, id, targetId);
    else if (kind === "reversal") await linkReversal(db(), user.id, id, targetId);
    else await linkTransfer(db(), user.id, id, targetId);
    revalidatePath("/", "layout");
    return "Linked.";
  });
}

export async function unlinkAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runAction(async () => {
    await unlinkTransaction(db(), user.id, formString(fd, "id")!);
    revalidatePath("/", "layout");
    return "Unlinked. It's back in the review queue.";
  });
}

export async function voidAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const result = await runAction(async () => {
    const reason = formString(fd, "reason")?.trim();
    if (!reason) throw new DomainError("reason_required", "Say why you're voiding it.");
    await voidTransaction(db(), user.id, formString(fd, "id")!, reason);
    return "Voided.";
  });
  if (result.error) return result;
  revalidatePath("/", "layout");
  redirect("/transactions");
}

export async function createManualAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const direction = formString(fd, "direction") === "credit" ? "credit" : "debit";
    const { transaction } = await createTransaction(
      db(),
      user.id,
      {
        transactionDate: formString(fd, "transactionDate") ?? "",
        amountPaise: rupeesToPaise(formString(fd, "amount")),
        direction,
        transactionType: (formString(fd, "transactionType") || (direction === "debit" ? "purchase" : "income")) as never,
        merchantName: formNullable(fd, "merchantName"),
        categoryId: formNullable(fd, "categoryId"),
        financialAccountId: formNullable(fd, "financialAccountId"),
        paymentMethod: (formString(fd, "paymentMethod") || "unknown") as never,
        notes: formNullable(fd, "notes"),
      },
      { captureMethod: "manual" },
    );
    createdId = transaction.id;
    return "Added.";
  });
  if (result.error || !createdId) return result;
  revalidatePath("/", "layout");
  redirect(`/transactions/${createdId}`);
}
