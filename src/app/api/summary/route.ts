import { z } from "zod";
import { istMonth, isValidMonth } from "@/lib/dates";
import { apiRoute, searchParamsObject } from "@/server/api";
import { db } from "@/server/db/client";
import { summarizeMonth } from "@/server/finance/transactions-service";

// GET /api/summary?month=2026-10
export const GET = apiRoute(async ({ req, user }) => {
  const { month } = z
    .object({ month: z.string().refine(isValidMonth, "Use YYYY-MM").default(istMonth(new Date())) })
    .parse(searchParamsObject(req));
  return { month, ...(await summarizeMonth(db(), user.id, month)) };
});
