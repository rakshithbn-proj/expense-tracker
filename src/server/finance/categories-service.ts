import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { DEFAULT_CATEGORIES, type DefaultCategoryKey } from "@/lib/finance-types";
import { recordAudit } from "@/server/audit";
import { categories } from "@/server/db/schema";
import { DomainError, isUniqueViolation, NotFoundError } from "@/server/errors";
import type { Executor } from "./db-types";

// Idempotent: safe to call on every login, seed or migration.
export async function ensureDefaultCategories(db: Executor, userId: string): Promise<void> {
  await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map((c) => ({ userId, name: c.name, systemKey: c.key })))
    .onConflictDoNothing();
}

export async function listCategories(db: Executor, userId: string) {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      systemKey: categories.systemKey,
      parentCategoryId: categories.parentCategoryId,
      isActive: categories.isActive,
    })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.name));
}

export async function getSystemCategoryId(db: Executor, userId: string, key: DefaultCategoryKey): Promise<string | null> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.systemKey, key)));
  return row?.id ?? null;
}

export async function assertCategoryOwned(db: Executor, userId: string, categoryId: string): Promise<void> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)));
  if (!row) throw new NotFoundError("Category");
}

export async function createCategory(
  db: Executor,
  userId: string,
  input: { name: string; parentCategoryId?: string | null },
) {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new DomainError("invalid_name", "Category names must be 1–60 characters.");
  if (input.parentCategoryId) await assertCategoryOwned(db, userId, input.parentCategoryId);
  const [row] = await db
    .insert(categories)
    .values({ userId, name, parentCategoryId: input.parentCategoryId ?? null })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new DomainError("duplicate_name", "A category with that name already exists.");
  await recordAudit(db, { userId, entityType: "category", entityId: row.id, action: "create" });
  return row;
}

export async function updateCategory(
  db: Executor,
  userId: string,
  id: string,
  patch: { name?: string; isActive?: boolean },
) {
  const [existing] = await db.select().from(categories).where(and(eq(categories.id, id), eq(categories.userId, userId)));
  if (!existing) throw new NotFoundError("Category");
  if (patch.isActive === false && existing.systemKey === "uncategorized") {
    throw new DomainError("protected_category", "The uncategorized category can't be deactivated.");
  }
  const name = patch.name?.trim();
  if (name !== undefined && (!name || name.length > 60)) {
    throw new DomainError("invalid_name", "Category names must be 1–60 characters.");
  }
  let row: typeof existing;
  try {
    [row] = await db
      .update(categories)
      .set({ name: name ?? existing.name, isActive: patch.isActive ?? existing.isActive, updatedAt: new Date() })
      .where(eq(categories.id, id))
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("duplicate_name", "A category with that name already exists.");
    throw err;
  }
  await recordAudit(db, {
    userId,
    entityType: "category",
    entityId: id,
    action: "update",
    metadata: { renamed: name !== undefined && name !== existing.name, isActive: row.isActive },
  });
  return row;
}
