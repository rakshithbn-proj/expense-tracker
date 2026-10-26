import { toServiceFilter, type FilterParams } from "@/app/(app)/transactions/filters";
import { istDate } from "@/lib/dates";
import { apiRoute, searchParamsObject } from "@/server/api";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { toCsv } from "@/server/export/csv";
import { transactionTable } from "@/server/export/table";
import { toXlsx } from "@/server/export/xlsx";
import { lookups } from "@/server/finance/reports-service";
import { allMatchingTransactions } from "@/server/finance/transactions-service";

export const dynamic = "force-dynamic";

// GET /api/export?format=csv|xlsx plus the explorer's filter parameters (q, from, to, ...).
// Exports every matching transaction, not just the page on screen.
export const GET = apiRoute(async ({ req, user }) => {
  const { format = "csv", ...params } = searchParamsObject(req);
  if (format !== "csv" && format !== "xlsx") throw new DomainError("invalid_format", "Use format=csv or format=xlsx.");
  // Paging in the filter is ignored: every match is exported.
  const filter = toServiceFilter(params as FilterParams);
  const [items, names] = await Promise.all([allMatchingTransactions(db(), user.id, filter), lookups(db(), user.id)]);
  const table = transactionTable(items, names);
  await recordAudit(db(), { userId: user.id, entityType: "export", action: format, metadata: { rows: items.length } });

  const filename = `transactions-${istDate(new Date())}.${format}`;
  const headers = {
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (format === "csv") return new Response(toCsv(table), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  return new Response(new Uint8Array(toXlsx(table)), {
    headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
});
