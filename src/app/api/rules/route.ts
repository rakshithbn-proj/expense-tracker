import { z } from "zod";
import { RULE_MATCH_TYPES } from "@/lib/finance-types";
import { apiRoute, readJson } from "@/server/api";
import { db } from "@/server/db/client";
import { listRules, upsertRule } from "@/server/finance/rules-service";

export const GET = apiRoute(async ({ user }) => ({ items: await listRules(db(), user.id) }));

const ruleSchema = z.object({
  matchType: z.enum(RULE_MATCH_TYPES),
  matchValue: z.string().trim().min(2).max(100),
  categoryId: z.string().uuid(),
  priority: z.number().int().min(0).max(1000).optional(),
});

export const POST = apiRoute(async ({ req, user }) => upsertRule(db(), user.id, ruleSchema.parse(await readJson(req))));
