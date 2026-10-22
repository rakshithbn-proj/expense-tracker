import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { db } from "@/server/db/client";
import { createCategory, listCategories } from "@/server/finance/categories-service";

export const GET = apiRoute(async ({ user }) => ({ items: await listCategories(db(), user.id) }));

const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  parentCategoryId: z.string().uuid().nullish(),
});

export const POST = apiRoute(async ({ req, user }) => createCategory(db(), user.id, categorySchema.parse(await readJson(req))));
