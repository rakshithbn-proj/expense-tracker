import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { AccountType } from "@/lib/finance-types";
import { recordAudit } from "@/server/audit";
import { financialAccounts } from "@/server/db/schema";
import { DomainError, NotFoundError } from "@/server/errors";
import type { Executor } from "./db-types";

export type AccountInput = {
  institutionName: string;
  accountName: string;
  accountType: AccountType;
  maskedIdentifier?: string | null;
  currency?: string;
  isSample?: boolean;
};

function validateMasked(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const digits = value.replace(/[^0-9]/g, "");
  // Only the last few digits are ever kept. Reject anything that looks like a full number.
  if (digits.length < 2 || digits.length > 6 || digits.length !== value.replace(/[\sXx*•-]/g, "").length) {
    throw new DomainError("invalid_masked_identifier", "Enter only the last 2–6 digits of the account or card.");
  }
  return digits;
}

export async function listAccounts(db: Executor, userId: string) {
  return db
    .select()
    .from(financialAccounts)
    .where(eq(financialAccounts.userId, userId))
    .orderBy(asc(financialAccounts.institutionName), asc(financialAccounts.accountName));
}

export async function getAccount(db: Executor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.id, id), eq(financialAccounts.userId, userId)));
  if (!row) throw new NotFoundError("Account");
  return row;
}

export async function createAccount(db: Executor, userId: string, input: AccountInput) {
  const institutionName = input.institutionName.trim();
  const accountName = input.accountName.trim();
  if (!institutionName || !accountName) throw new DomainError("invalid_account", "Institution and account name are required.");
  const [row] = await db
    .insert(financialAccounts)
    .values({
      userId,
      institutionName,
      accountName,
      accountType: input.accountType,
      maskedIdentifier: validateMasked(input.maskedIdentifier),
      currency: input.currency ?? "INR",
      isSample: input.isSample ?? false,
    })
    .returning();
  await recordAudit(db, { userId, entityType: "account", entityId: row.id, action: "create" });
  return row;
}

export async function updateAccount(
  db: Executor,
  userId: string,
  id: string,
  patch: { accountName?: string; isActive?: boolean },
) {
  const existing = await getAccount(db, userId, id);
  const [row] = await db
    .update(financialAccounts)
    .set({
      accountName: patch.accountName?.trim() || existing.accountName,
      isActive: patch.isActive ?? existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(financialAccounts.id, id))
    .returning();
  await recordAudit(db, { userId, entityType: "account", entityId: id, action: "update", metadata: { isActive: row.isActive } });
  return row;
}
