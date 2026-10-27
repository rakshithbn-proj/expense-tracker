import { ActionForm } from "@/components/action-form";
import { buttonClass, Card, Definition, EmptyState, inputClass, PageHeader, TextLink } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { getExplainSettings, listToExplain } from "@/server/explain/service";
import { lookups } from "@/server/finance/reports-service";
import { explainAction } from "./actions";

export const metadata = { title: "To explain · Expenses" };

const label = "flex flex-col gap-1 text-xs font-medium text-muted";

export default async function ExplainPage() {
  const user = await requireUser();
  const [items, names, settings] = await Promise.all([listToExplain(db(), user.id), lookups(db(), user.id), getExplainSettings(db(), user.id)]);
  const active = names.categories.filter((c) => c.isActive);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="To explain" />
      <Card title={items.length ? `${items.length} payment${items.length === 1 ? "" : "s"} waiting` : undefined}>
        {items.length === 0 ? (
          <EmptyState>Every payment is explained.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((i) => (
              <li key={i.id} className="rounded-xl border border-border p-3" data-testid="explain-item">
                <p className="mb-2 text-sm font-semibold break-words">{i.label}</p>
                <ActionForm action={explainAction} submitLabel="Save" buttonClassName={buttonClass}>
                  <input type="hidden" name="id" value={i.id} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className={label}>
                      Category
                      <select name="categoryId" defaultValue={i.categoryId ?? ""} required className={inputClass}>
                        <option value="" disabled>
                          Choose…
                        </option>
                        {active.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={label}>
                      Why was this? (optional)
                      <input name="reason" maxLength={500} placeholder="e.g. Dinner with Ravi" className={inputClass} />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="remember" className="h-4 w-4" />
                    Always use this category for this payee
                  </label>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <Definition>
          Spending payments captured since {formatDateTime(settings.askFrom.toISOString())}, oldest first. Card bills, transfers between your own
          accounts and income are never asked about. Your iPhone asks about these too: see the schedule in{" "}
          <TextLink href="/settings#explain">Settings</TextLink>.
        </Definition>
      </Card>
    </div>
  );
}
