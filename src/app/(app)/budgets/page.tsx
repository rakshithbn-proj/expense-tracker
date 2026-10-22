import { ActionForm } from "@/components/action-form";
import { BudgetMeter } from "@/components/charts/budget-meter";
import { buttonClass, Card, Definition, EmptyState, inputClass, PageHeader, secondaryButtonClass } from "@/components/ui";
import { istDate } from "@/lib/dates";
import { formatInr, formatMonth, formatMonthShort } from "@/lib/format";
import { decimalToPaise } from "@/lib/money";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { budgetInForce } from "@/server/finance/budget";
import { budgetReport, listBudgets } from "@/server/finance/budgets-service";
import { budgetSuggestions, lookups } from "@/server/finance/reports-service";
import { removeBudgetAction, setBudgetAction } from "./actions";

export const metadata = { title: "Budgets · Expenses" };

export default async function BudgetsPage() {
  const user = await requireUser();
  const month = istDate(new Date()).slice(0, 7);
  const [report, rows, names, suggestions] = await Promise.all([
    budgetReport(db(), user.id, month),
    listBudgets(db(), user.id),
    lookups(db(), user.id),
    budgetSuggestions(db(), user.id, month),
  ]);

  const usage = new Map<string | null, NonNullable<typeof report.overall>>();
  if (report.overall) usage.set(null, report.overall);
  for (const c of report.categories) usage.set(c.categoryId, c);

  const targets: { id: string | null; name: string }[] = [
    { id: null, name: "Overall (all spending)" },
    ...names.categories.filter((c) => c.isActive && c.systemKey !== "investments").map((c) => ({ id: c.id, name: c.name })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Budgets" />
      <p className="text-sm text-muted">
        Monthly limits for {formatMonth(month)}. A limit applies from the month you set it until you change it.
      </p>

      <Card title="Suggested limits">
        {suggestions === null ? (
          <EmptyState>Suggestions need three complete months of history before this month. Nothing is suggested until then.</EmptyState>
        ) : suggestions.length === 0 ? (
          <EmptyState>No spending in the last three months to base suggestions on.</EmptyState>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {suggestions.map((s) => {
                const name = s.scope === "overall" ? "Overall" : s.categoryId ? (names.categoryName.get(s.categoryId) ?? "Category") : "Uncategorized";
                if (s.scope === "category" && !s.categoryId) return null;
                return (
                  <li key={`${s.scope}-${s.categoryId}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-sm first:border-t-0 first:pt-0">
                    <span>
                      <strong>{name}</strong>: average {formatInr(s.averagePaise)} a month ({s.months.map(formatMonthShort).join(", ")})
                    </span>
                    <ActionForm action={setBudgetAction} submitLabel={`Use ${formatInr(s.suggestedPaise)}`} buttonClassName={secondaryButtonClass}>
                      <input type="hidden" name="categoryId" value={s.categoryId ?? ""} />
                      <input type="hidden" name="fromMonth" value={month} />
                      <input type="hidden" name="limit" value={(s.suggestedPaise / 100).toFixed(2)} />
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
            <Definition>Each suggestion is the three-month average rounded up to the next ₹500. Nothing is saved until you choose “Use”.</Definition>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {targets.map((target) => {
          const inForce = budgetInForce(rows.filter((r) => r.categoryId === target.id), month);
          const used = usage.get(target.id);
          return (
            <Card key={target.id ?? "overall"} title={target.name}>
              {used ? <BudgetMeter label="This month" {...used} /> : <p className="text-sm text-muted">No limit set.</p>}
              <ActionForm action={setBudgetAction} submitLabel={inForce ? "Update" : "Set limit"} buttonClassName={buttonClass} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="categoryId" value={target.id ?? ""} />
                <input type="hidden" name="fromMonth" value={month} />
                <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted">
                  Monthly limit (₹)
                  <input
                    name="limit"
                    inputMode="decimal"
                    required
                    defaultValue={inForce ? (decimalToPaise(inForce.limitAmount) / 100).toFixed(2) : ""}
                    className={inputClass}
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs font-medium text-muted">
                  Warn at (%)
                  <input name="warnAtPercent" type="number" min={1} max={100} defaultValue={inForce?.warnAtPercent ?? 80} className={inputClass} />
                </label>
              </ActionForm>
              {inForce && (
                <ActionForm action={removeBudgetAction} submitLabel="Remove budget" pendingLabel="Removing…" buttonClassName="mt-2 text-sm text-muted underline" className="flex">
                  <input type="hidden" name="categoryId" value={target.id ?? ""} />
                </ActionForm>
              )}
            </Card>
          );
        })}
      </div>
      <Definition>{report.definition}</Definition>
    </div>
  );
}
