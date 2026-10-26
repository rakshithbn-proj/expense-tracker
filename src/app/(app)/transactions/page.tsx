import Link from "next/link";
import { ZodError } from "zod";
import { TransactionRow } from "@/components/transaction-row";
import { buttonClass, Card, EmptyState, inputClass, PageHeader, SampleBanner, secondaryButtonClass } from "@/components/ui";
import { CAPTURE_METHODS, PAYMENT_METHODS, TRANSACTION_STATUSES, TRANSACTION_TYPES } from "@/lib/finance-types";
import { CAPTURE_LABELS, formatDayHeading, formatInr, METHOD_LABELS, STATUS_LABELS, TYPE_LABELS } from "@/lib/format";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { lookups } from "@/server/finance/reports-service";
import { listTransactions, type TransactionDto } from "@/server/finance/transactions-service";
import { activeFilterCount, toServiceFilter, withParams, type FilterParams } from "./filters";

export const metadata = { title: "Transactions · Expenses" };

function Select({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <select name={name} defaultValue={value ?? ""} className={inputClass}>
        <option value="">Any</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({ name, label, value, type = "text", placeholder }: { name: string; label: string; value?: string; type?: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <input name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} className={inputClass} step={type === "number" ? "0.01" : undefined} min={type === "number" ? 0 : undefined} />
    </label>
  );
}

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const user = await requireUser();
  const raw = await searchParams;
  const params: FilterParams = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")) as FilterParams;
  const names = await lookups(db(), user.id);

  let result: Awaited<ReturnType<typeof listTransactions>> | null = null;
  let error: string | null = null;
  try {
    result = await listTransactions(db(), user.id, toServiceFilter(params));
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    error = "Some filters aren't valid. Check the dates (YYYY-MM-DD) and amounts.";
  }

  const active = activeFilterCount(params);
  const groups = new Map<string, TransactionDto[]>();
  for (const t of result?.items ?? []) groups.set(t.transactionDate, [...(groups.get(t.transactionDate) ?? []), t]);
  const sortedByDate = (params.sort ?? "date-desc").startsWith("date");
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const exportQuery = new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== "page" && v) as [string, string][]);
  const exportHref = (format: "csv" | "xlsx") => `/api/export?${new URLSearchParams([["format", format], ...exportQuery])}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Transactions">
        <a href={exportHref("csv")} className={secondaryButtonClass} download>
          Export CSV
        </a>
        <a href={exportHref("xlsx")} className={secondaryButtonClass} download>
          Export Excel
        </a>
        <Link href="/transactions/new" className={buttonClass}>
          Add manually
        </Link>
      </PageHeader>

      <details className="rounded-2xl border border-border bg-surface p-4" open={active > 0}>
        <summary className="cursor-pointer text-sm font-semibold">
          Filters{active > 0 ? ` (${active} active)` : ""}
        </summary>
        <form method="get" action="/transactions" className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2">
            <Field name="q" label="Search merchant or description" value={params.q} placeholder="e.g. Swiggy" />
          </div>
          <Field name="from" label="From" type="date" value={params.from} />
          <Field name="to" label="To" type="date" value={params.to} />
          <Select
            name="category"
            label="Category"
            value={params.category}
            options={[["uncategorized", "Uncategorized"], ...names.categories.map((c): [string, string] => [c.id, c.name])]}
          />
          <Select name="account" label="Account or card" value={params.account} options={[...names.accountName.entries()]} />
          <Select name="method" label="Payment method" value={params.method} options={PAYMENT_METHODS.map((m): [string, string] => [m, METHOD_LABELS[m]])} />
          <Field name="app" label="Payment app (when known)" value={params.app} placeholder="e.g. PhonePe" />
          <Field name="min" label="Min amount (₹)" type="number" value={params.min} />
          <Field name="max" label="Max amount (₹)" type="number" value={params.max} />
          <Select name="status" label="Status" value={params.status} options={TRANSACTION_STATUSES.map((s): [string, string] => [s, STATUS_LABELS[s]])} />
          <Select name="type" label="Type" value={params.type} options={TRANSACTION_TYPES.map((t): [string, string] => [t, TYPE_LABELS[t]])} />
          <Select name="capture" label="Captured by" value={params.capture} options={CAPTURE_METHODS.map((c): [string, string] => [c, CAPTURE_LABELS[c]])} />
          <Select
            name="sort"
            label="Sort"
            value={params.sort}
            options={[
              ["date-desc", "Newest first"],
              ["date-asc", "Oldest first"],
              ["amount-desc", "Largest first"],
              ["amount-asc", "Smallest first"],
            ]}
          />
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="review" value="1" defaultChecked={params.review === "1"} className="h-4 w-4" />
            Only transactions that need review
          </label>
          <div className="col-span-2 flex gap-2 md:justify-end">
            <Link href="/transactions" className={secondaryButtonClass}>
              Clear
            </Link>
            <button type="submit" className={buttonClass}>
              Apply filters
            </button>
          </div>
        </form>
      </details>

      {error && (
        <p role="alert" className="rounded-xl border border-danger p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {result && (
        <>
          <SampleBanner count={result.items.filter((t) => t.isSample).length} />
          <p className="text-sm text-muted" data-testid="result-count">
            {result.total} transaction{result.total === 1 ? "" : "s"}
            {pages > 1 ? ` · page ${result.page} of ${pages}` : ""}
          </p>
          <Card>
            {result.items.length === 0 ? (
              <EmptyState>No transactions match these filters.</EmptyState>
            ) : sortedByDate ? (
              <div className="-mx-2 flex flex-col gap-3">
                {[...groups.entries()].map(([date, txs]) => (
                  <section key={date}>
                    <h2 className="flex justify-between px-2 pb-1 text-xs font-semibold text-muted">
                      <span>{formatDayHeading(date)}</span>
                      <span className="tabular-nums">
                        {formatInr(txs.filter((t) => t.direction === "debit" && t.transactionStatus !== "failed" && t.transactionStatus !== "reversed").reduce((s, t) => s + t.amountPaise, 0))} out
                      </span>
                    </h2>
                    <ul>
                      {txs.map((t) => (
                        <TransactionRow key={t.id} t={t} categoryName={names.categoryName} accountName={names.accountName} showDate={false} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <ul className="-mx-2">
                {result.items.map((t) => (
                  <TransactionRow key={t.id} t={t} categoryName={names.categoryName} accountName={names.accountName} />
                ))}
              </ul>
            )}
          </Card>
          {pages > 1 && (
            <nav aria-label="Pages" className="flex justify-between">
              {result.page > 1 ? (
                <Link className={secondaryButtonClass} href={withParams(params, { page: String(result.page - 1) })}>
                  ‹ Previous
                </Link>
              ) : (
                <span />
              )}
              {result.page < pages && (
                <Link className={secondaryButtonClass} href={withParams(params, { page: String(result.page + 1) })}>
                  Next ›
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
