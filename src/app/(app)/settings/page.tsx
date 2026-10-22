import { ActionForm } from "@/components/action-form";
import { Badge, buttonClass, Card, Definition, EmptyState, inputClass, PageHeader } from "@/components/ui";
import { ACCOUNT_TYPES } from "@/lib/finance-types";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { lookups } from "@/server/finance/reports-service";
import { listRules } from "@/server/finance/rules-service";
import { addAccountAction, addCategoryAction, toggleAccountAction, toggleRuleAction, updateCategoryAction } from "./actions";

export const metadata = { title: "Settings · Expenses" };

const ACCOUNT_TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  bank_account: "Bank account",
  credit_card: "Credit card",
  wallet: "Wallet",
  cash: "Cash",
  investment: "Investment account",
  loan: "Loan",
};
const MATCH_LABELS = { merchant_exact: "Merchant is", merchant_contains: "Merchant contains", description_contains: "Description contains" } as const;
const label = "flex flex-col gap-1 text-xs font-medium text-muted";
const linkButton = "text-sm text-muted underline";

export default async function SettingsPage() {
  const user = await requireUser();
  const [names, rules] = await Promise.all([lookups(db(), user.id), listRules(db(), user.id)]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" />

      <Card title="Accounts and cards">
        {names.accounts.length === 0 ? (
          <EmptyState>No accounts yet. Add your bank accounts and each credit card below.</EmptyState>
        ) : (
          <ul className="mb-4 flex flex-col">
            {names.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-t-0">
                <span className="text-sm">
                  {names.accountName.get(a.id)} <span className="text-muted">· {ACCOUNT_TYPE_LABELS[a.accountType]}</span>{" "}
                  {a.isSample && <Badge>Sample</Badge>} {!a.isActive && <Badge>Hidden</Badge>}
                </span>
                <ActionForm action={toggleAccountAction} submitLabel={a.isActive ? "Hide" : "Show"} buttonClassName={linkButton} className="flex">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="isActive" value={String(!a.isActive)} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addAccountAction} submitLabel="Add account" buttonClassName={buttonClass} testId="add-account-form">
          <div className="grid gap-3 md:grid-cols-4">
            <label className={label}>
              Bank or issuer
              <input name="institutionName" required maxLength={80} placeholder="e.g. HDFC Bank" className={inputClass} />
            </label>
            <label className={label}>
              Name
              <input name="accountName" required maxLength={80} placeholder="e.g. Regalia card" className={inputClass} />
            </label>
            <label className={label}>
              Type
              <select name="accountType" defaultValue="bank_account" className={inputClass}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Last digits (optional)
              <input name="maskedIdentifier" inputMode="numeric" maxLength={6} pattern="[0-9]{2,6}" placeholder="e.g. 4321" className={inputClass} />
            </label>
          </div>
        </ActionForm>
        <Definition>Only the last 2–6 digits are stored, to tell accounts apart in alerts. Never enter a full card or account number.</Definition>
      </Card>

      <Card title="Categories">
        <ul className="mb-4 flex flex-col">
          {names.categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-end justify-between gap-2 border-t border-border py-2 first:border-t-0">
              <ActionForm action={updateCategoryAction} submitLabel="Rename" buttonClassName={linkButton} className="flex flex-1 items-end gap-2">
                <input type="hidden" name="id" value={c.id} />
                <input name="name" defaultValue={c.name} aria-label={`Name for ${c.name}`} maxLength={60} className={`${inputClass} max-w-xs`} />
              </ActionForm>
              <div className="flex items-center gap-2">
                {!c.isActive && <Badge>Inactive</Badge>}
                {c.systemKey !== "uncategorized" && (
                  <ActionForm action={updateCategoryAction} submitLabel={c.isActive ? "Deactivate" : "Activate"} buttonClassName={linkButton} className="flex">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="isActive" value={String(!c.isActive)} />
                  </ActionForm>
                )}
              </div>
            </li>
          ))}
        </ul>
        <ActionForm action={addCategoryAction} submitLabel="Add category" buttonClassName={buttonClass} className="flex flex-wrap items-end gap-3">
          <label className={`${label} flex-1`}>
            New category
            <input name="name" required maxLength={60} className={inputClass} />
          </label>
        </ActionForm>
        <Definition>Deactivated categories keep their past transactions but aren&apos;t offered for new ones.</Definition>
      </Card>

      <Card title="Category rules">
        {rules.length === 0 ? (
          <EmptyState>
            No rules yet. When you correct a transaction&apos;s category, tick “Always use this category” to create one.
          </EmptyState>
        ) : (
          <ul className="flex flex-col">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
                <span>
                  {MATCH_LABELS[r.matchType]} “{r.matchValue}” → <strong>{names.categoryName.get(r.categoryId)}</strong>{" "}
                  <span className="text-muted">· priority {r.priority}</span> {r.isSample && <Badge>Sample</Badge>} {!r.isActive && <Badge>Off</Badge>}
                </span>
                <ActionForm action={toggleRuleAction} submitLabel={r.isActive ? "Turn off" : "Turn on"} buttonClassName={linkButton} className="flex">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="isActive" value={String(!r.isActive)} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <Definition>
          Rules apply to new transactions only, highest priority first (older rules win ties). Turning a rule off doesn&apos;t change transactions it
          already categorized.
        </Definition>
      </Card>
    </div>
  );
}
