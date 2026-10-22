import { apiRoute, readJson, searchParamsObject } from "@/server/api";
import { db } from "@/server/db/client";
import { createTransaction, listTransactions } from "@/server/finance/transactions-service";

// GET /api/transactions?q=&from=&to=&categoryIds=a,b&accountIds=&paymentMethods=&types=&statuses=
//   &minAmountPaise=&maxAmountPaise=&needsReview=&sort=date|amount&order=asc|desc&page=&pageSize=
export const GET = apiRoute(async ({ req, user }) => listTransactions(db(), user.id, searchParamsObject(req)));

// Manual entry. Always recorded as capture method "manual", never counted as automatic.
export const POST = apiRoute(async ({ req, user }) => {
  const result = await createTransaction(db(), user.id, (await readJson(req)) as never, { captureMethod: "manual" });
  return Response.json(result, { status: result.created ? 201 : 200 });
});
