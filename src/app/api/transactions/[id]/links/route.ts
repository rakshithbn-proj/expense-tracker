import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { db } from "@/server/db/client";
import {
  linkRefund,
  linkReversal,
  linkTransfer,
  suggestLinks,
  unlinkTransaction,
} from "@/server/finance/transactions-service";

type Ctx = RouteContext<"/api/transactions/[id]/links">;
const idSchema = z.string().uuid();
const linkSchema = z.object({
  kind: z.enum(["refund", "reversal", "transfer"]),
  targetId: z.string().uuid(),
});

// Suggested originals for a refund or reversal. Changes nothing.
export const GET = apiRoute<Ctx>(async ({ user, ctx }) => suggestLinks(db(), user.id, idSchema.parse((await ctx.params).id)));

// { kind: "refund" | "reversal", targetId: <original> } or { kind: "transfer", targetId: <other side> }
export const POST = apiRoute<Ctx>(async ({ req, user, ctx }) => {
  const id = idSchema.parse((await ctx.params).id);
  const { kind, targetId } = linkSchema.parse(await readJson(req));
  if (kind === "refund") return linkRefund(db(), user.id, id, targetId);
  if (kind === "reversal") return linkReversal(db(), user.id, id, targetId);
  return linkTransfer(db(), user.id, id, targetId);
});

export const DELETE = apiRoute<Ctx>(async ({ user, ctx }) => unlinkTransaction(db(), user.id, idSchema.parse((await ctx.params).id)));
