import { z } from "zod";
import { istMonth } from "@/lib/dates";
import { apiRoute, readJson, searchParamsObject } from "@/server/api";
import { db } from "@/server/db/client";
import { budgetReport, setBudget } from "@/server/finance/budgets-service";

// GET /api/budgets?month=2026-10 -> usage of every budget in force that month
export const GET = apiRoute(async ({ req, user }) => {
  const { month } = z.object({ month: z.string().default(istMonth(new Date())) }).parse(searchParamsObject(req));
  return budgetReport(db(), user.id, month);
});

const budgetSchema = z.object({
  categoryId: z.string().uuid().nullable(),
  fromMonth: z.string(),
  limitPaise: z.number().int().positive(),
  warnAtPercent: z.number().int().min(1).max(100).optional(),
});

export const PUT = apiRoute(async ({ req, user }) => setBudget(db(), user.id, budgetSchema.parse(await readJson(req))));
