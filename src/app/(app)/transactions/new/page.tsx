import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { buttonClass, Card, Definition, inputClass, PageHeader } from "@/components/ui";
import { istDate } from "@/lib/dates";
import { PAYMENT_METHODS, TRANSACTION_TYPES } from "@/lib/finance-types";
import { METHOD_LABELS, TYPE_LABELS } from "@/lib/format";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { lookups } from "@/server/finance/reports-service";
import { createManualAction } from "../actions";

export const metadata = { title: "Add transaction · Expenses" };

const label = "flex flex-col gap-1 text-xs font-medium text-muted";

export default async function NewTransactionPage() {
  const user = await requireUser();
  const names = await lookups(db(), user.id);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/transactions" className="text-sm text-muted hover:underline">
        ‹ Transactions
      </Link>
      <PageHeader title="Add a transaction manually" />
      <Card>
        <ActionForm action={createManualAction} submitLabel="Add transaction" pendingLabel="Adding…" buttonClassName={buttonClass} testId="new-transaction-form">
          <div className="grid gap-3 md:grid-cols-2">
            <label className={label}>
              Amount (₹)
              <input name="amount" inputMode="decimal" required className={inputClass} placeholder="e.g. 450.00" />
            </label>
            <label className={label}>
              Date
              <input name="transactionDate" type="date" required defaultValue={istDate(new Date())} className={inputClass} />
            </label>
            <label className={label}>
              Money
              <select name="direction" defaultValue="debit" className={inputClass}>
                <option value="debit">Went out (debit)</option>
                <option value="credit">Came in (credit)</option>
              </select>
            </label>
            <label className={label}>
              Type
              <select name="transactionType" defaultValue="purchase" className={inputClass}>
                {TRANSACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Merchant or payee
              <input name="merchantName" maxLength={200} className={inputClass} />
            </label>
            <label className={label}>
              Category
              <select name="categoryId" defaultValue="" className={inputClass}>
                <option value="">Use my rules, or leave uncategorized</option>
                {names.categories
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={label}>
              Account
              <select name="financialAccountId" defaultValue="" className={inputClass}>
                <option value="">Unknown</option>
                {[...names.accountName.entries()].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Payment method
              <select name="paymentMethod" defaultValue="unknown" className={inputClass}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${label} md:col-span-2`}>
              Notes
              <input name="notes" maxLength={2000} className={inputClass} />
            </label>
          </div>
        </ActionForm>
        <Definition>
          Manual entries are a fallback. They are recorded as “Entered manually” and never count toward automatic capture coverage. Refunds,
          reversals and transfers are linked automatically when there is exactly one clear match; otherwise they wait in the review queue.
        </Definition>
      </Card>
    </div>
  );
}
