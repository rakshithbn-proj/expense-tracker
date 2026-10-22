import { z } from "zod";
import { apiRoute, readJson, searchParamsObject } from "@/server/api";
import { db } from "@/server/db/client";
import { correctTransaction, getTransaction, voidTransaction } from "@/server/finance/transactions-service";

type Ctx = RouteContext<"/api/transactions/[id]">;
const idSchema = z.string().uuid();

export const GET = apiRoute<Ctx>(async ({ user, ctx }) =>
  getTransaction(db(), user.id, idSchema.parse((await ctx.params).id)),
);

export const PATCH = apiRoute<Ctx>(async ({ req, user, ctx }) =>
  correctTransaction(db(), user.id, idSchema.parse((await ctx.params).id), (await readJson(req)) as never),
);

// Voids (never deletes) the transaction. DELETE /api/transactions/:id?reason=...
export const DELETE = apiRoute<Ctx>(async ({ req, user, ctx }) => {
  const { reason } = z.object({ reason: z.string().trim().min(1).max(200) }).parse(searchParamsObject(req));
  return voidTransaction(db(), user.id, idSchema.parse((await ctx.params).id), reason);
});
