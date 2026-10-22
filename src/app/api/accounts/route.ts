import { z } from "zod";
import { ACCOUNT_TYPES } from "@/lib/finance-types";
import { apiRoute, readJson } from "@/server/api";
import { db } from "@/server/db/client";
import { createAccount, listAccounts } from "@/server/finance/accounts-service";

export const GET = apiRoute(async ({ user }) => ({ items: await listAccounts(db(), user.id) }));

const accountSchema = z.object({
  institutionName: z.string().trim().min(1).max(80),
  accountName: z.string().trim().min(1).max(80),
  accountType: z.enum(ACCOUNT_TYPES),
  maskedIdentifier: z.string().max(12).nullish(),
});

export const POST = apiRoute(async ({ req, user }) => createAccount(db(), user.id, accountSchema.parse(await readJson(req))));
