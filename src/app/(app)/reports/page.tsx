import Link from "next/link";
import type { ReactNode } from "react";
import { BarList } from "@/components/charts/bar-list";
import { BudgetMeter } from "@/components/charts/budget-meter";
import { ColumnChart } from "@/components/charts/column-chart";
import { InsightList } from "@/components/insight-list";
import { TransactionRow } from "@/components/transaction-row";
import { Card, Definition, EmptyState, PageHeader, SampleBanner, TextLink } from "@/components/ui";
import { addDays, addMonths, daysBetween, istDate, isValidDate } from "@/lib/dates";
import { CAPTURE_LABELS, formatDate, formatDayShort, formatInr, formatMonth, formatMonthShort, METHOD_LABELS } from "@/lib/format";
import type { CaptureMethod, PaymentMethod } from "@/lib/finance-types";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { channelOf, groupSpending, totalSpending, weekdayPattern } from "@/server/finance/analytics";
import { budgetReport } from "@/server/finance/budgets-service";
import { lookups, reports } from "@/server/finance/reports-service";
import { listTransactions } from "@/server/finance/transactions-service";

export const metadata = { title: "Reports · Expenses" };

const REPORTS = [
  ["category", "Categories"],
  ["monthly", "Month to month"],
  ["merchant", "Merchants"],
  ["account", "Accounts & cards"],
  ["method", "UPI vs cards"],
  ["trends", "Daily & weekly"],
  ["recurring", "Recurring"],
  ["budgets", "Budgets"],
  ["cashflow", "Cash flow"],
  ["investments", "Investments"],
  ["refunds", "Refunds & reversals"],
  ["coverage", "Capture coverage"],
  ["reconciliation", "Reconciliation"],
  ["insights", "Insights"],
] as const;
type ReportKey = (typeof REPORTS)[number][0];

const NET_SPENDING =
  "Includes purchases and fees (completed and pending) minus refunds and unlinked reversals. Excludes own-account transfers, card bill payments, income, investments, cash withdrawals, failed and reversed payments, voided entries and non-INR amounts.";

function Table({ head, rows, foot }: { head: string[]; rows: ReactNode[][]; foot?: ReactNode[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[28rem] text-left text-sm tabular-nums">
        <thead>
          <tr className="text-xs text-muted">
            {head.map((h, i) => (
              <th key={h} className={`py-2 pr-3 font-medium ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) => (
                <td key={j} className={`py-2 pr-3 ${j > 0 ? "text-right" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              {foot.map((c, j) => (
                <td key={j} className={`py-2 pr-3 ${j > 0 ? "text-right" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = istDate(new Date());
  const thisMonth = today.slice(0, 7);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  const report: ReportKey = REPORTS.some(([k]) => k === str(sp.r)) ? (str(sp.r) as ReportKey) : "category";
  let from = str(sp.from) && isValidDate(str(sp.from)!) ? str(sp.from)! : `${thisMonth}-01`;
  let to = str(sp.to) && isValidDate(str(sp.to)!) ? str(sp.to)! : today;
  if (to < from) [from, to] = [to, from];
  if (daysBetween(from, to) > 366) from = addDays(to, -366);

  const [data, names] = await Promise.all([reports(db(), user.id, { from, to }, today), lookups(db(), user.id)]);
  const items = data.items;
  const catName = (id: string) => (id === "uncategorized" ? "Uncategorized" : (names.categoryName.get(id) ?? "Unknown category"));
  const rangeLabel = `${formatDate(from)} – ${formatDate(to)}`;
  const qs = (changes: Record<string, string>) => new URLSearchParams({ r: report, from, to, ...changes }).toString();

  const lastMonth = addMonths(thisMonth, -1);
  const presets: [string, string, string][] = [
    ["This month", `${thisMonth}-01`, today],
    ["Last month", `${lastMonth}-01`, addDays(`${thisMonth}-01`, -1)],
    ["Last 3 months", `${addMonths(thisMonth, -2)}-01`, today],
    ["This year", `${today.slice(0, 4)}-01-01`, today],
  ];
  const sixMonths = `${formatMonthShort(data.monthly[0].month)} – ${formatMonthShort(data.monthly[5].month)}`;

  let body: ReactNode;
  switch (report) {
    case "category": {
      const groups = groupSpending(items, (t) => t.effectCategoryId, "uncategorized");
      body = (
        <Card title={`Spending by category · ${rangeLabel}`}>
          <BarList
            items={groups.map((g) => ({
              key: g.key,
              label: catName(g.key),
              paise: g.paise,
              detail: `${g.count} transaction${g.count === 1 ? "" : "s"}`,
              href: `/transactions?from=${from}&to=${to}&category=${g.key}`,
            }))}
            emptyText="No spending in this period."
          />
          <p className="mt-4 text-sm font-semibold">Total {formatInr(totalSpending(items))}</p>
          <Definition>{NET_SPENDING} A refund counts in the category of the purchase it refunds.</Definition>
        </Card>
      );
      break;
    }
    case "monthly": {
      const catIds = [...new Set(data.monthly.flatMap((m) => Object.keys(m.byCategory)))].sort((a, b) => catName(a).localeCompare(catName(b)));
      body = (
        <>
          <Card title={`Net spending by month · ${sixMonths}`}>
            <ColumnChart caption="Net spending for each of the last six months" columns={data.monthly.map((m) => ({ label: formatMonthShort(m.month), paise: m.netSpendPaise }))} />
            <Definition>{NET_SPENDING} The six months end with the month of the range end date.</Definition>
          </Card>
          <Card title="By category and month">
            {catIds.length === 0 ? (
              <EmptyState>No spending in these months.</EmptyState>
            ) : (
              <Table
                head={["Category", ...data.monthly.map((m) => formatMonthShort(m.month))]}
                rows={catIds.map((c) => [catName(c), ...data.monthly.map((m) => (m.byCategory[c] ? formatInr(m.byCategory[c]) : "—"))])}
                foot={["Net spending", ...data.monthly.map((m) => formatInr(m.netSpendPaise))]}
              />
            )}
          </Card>
        </>
      );
      break;
    }
    case "merchant": {
      const groups = groupSpending(items, (t) => t.merchantKey, "Unknown merchant");
      const display = new Map(items.filter((t) => t.merchantKey).map((t) => [t.merchantKey!, t.merchant ?? t.merchantKey!]));
      body = (
        <Card title={`Spending by merchant · ${rangeLabel}`}>
          <BarList
            items={groups.slice(0, 25).map((g) => ({
              key: g.key,
              label: display.get(g.key) ?? g.key,
              paise: g.paise,
              detail: `${g.count} transaction${g.count === 1 ? "" : "s"}`,
            }))}
            emptyText="No spending in this period."
          />
          <Definition>
            {NET_SPENDING} Merchants are grouped by a normalized name (prefixes like “UPI/” and reference numbers removed). Top 25 shown.
          </Definition>
        </Card>
      );
      break;
    }
    case "account": {
      const groups = groupSpending(items, (t) => t.accountId, "unknown");
      body = (
        <Card title={`Spending by account and card · ${rangeLabel}`}>
          <BarList
            items={groups.map((g) => ({
              key: g.key,
              label: g.key === "unknown" ? "Account not known" : (names.accountName.get(g.key) ?? "Unknown account"),
              paise: g.paise,
              detail: `${g.count} transaction${g.count === 1 ? "" : "s"}`,
              href: g.key === "unknown" ? undefined : `/transactions?from=${from}&to=${to}&account=${g.key}`,
            }))}
            emptyText="No spending in this period."
          />
          <Definition>{NET_SPENDING} Spending is shown on the account or card it was paid from. Card bill payments from a bank account are not counted again.</Definition>
        </Card>
      );
      break;
    }
    case "method": {
      const channels = groupSpending(items, (t) => channelOf(t.paymentMethod));
      const methods = groupSpending(items, (t) => t.paymentMethod);
      const apps = groupSpending(items.filter((t) => t.paymentMethod === "upi"), (t) => t.paymentApp, "App not known");
      body = (
        <>
          <Card title={`UPI vs cards · ${rangeLabel}`}>
            <BarList items={channels.map((g) => ({ key: g.key, label: g.key, paise: g.paise, detail: `${g.count} transactions` }))} emptyText="No spending in this period." />
            <Definition>{NET_SPENDING} “Cards” combines credit and debit cards. “Other” includes net banking, auto-debits, cash, wallets and unknown methods.</Definition>
          </Card>
          <Card title="By payment method">
            <BarList items={methods.map((g) => ({ key: g.key, label: METHOD_LABELS[g.key as PaymentMethod] ?? g.key, paise: g.paise }))} />
          </Card>
          <Card title="UPI by app">
            <BarList items={apps.map((g) => ({ key: g.key, label: g.key, paise: g.paise }))} emptyText="No UPI spending in this period." />
            <Definition>The app is only shown when a source actually said which app was used; it is never guessed. Bank alerts usually don&apos;t say.</Definition>
          </Card>
        </>
      );
      break;
    }
    case "trends": {
      const days = daysBetween(from, to) + 1;
      const daily = new Map<string, number>();
      for (const t of items) daily.set(t.date, (daily.get(t.date) ?? 0) + t.effectPaise);
      const columns =
        days <= 31
          ? Array.from({ length: days }, (_, i) => {
              const d = addDays(from, i);
              return { label: formatDayShort(d), paise: daily.get(d) ?? 0 };
            })
          : Array.from({ length: Math.ceil(days / 7) }, (_, w) => {
              const start = addDays(from, w * 7);
              const end = addDays(start, 6) > to ? to : addDays(start, 6);
              let sum = 0;
              for (let i = 0; i <= daysBetween(start, end); i++) sum += daily.get(addDays(start, i)) ?? 0;
              return { label: formatDayShort(start), paise: sum, detail: `Week of ${formatDate(start)}` };
            });
      const weekdays = weekdayPattern(items, from, to);
      body = (
        <>
          <Card title={`${days <= 31 ? "Daily" : "Weekly"} spending · ${rangeLabel}`}>
            <ColumnChart caption={`${days <= 31 ? "Daily" : "Weekly"} net spending`} columns={columns} />
            <Definition>{NET_SPENDING} Ranges longer than 31 days are shown as weeks starting on the range start date.</Definition>
          </Card>
          <Card title="Average by day of the week">
            <ColumnChart
              caption="Average net spending per weekday"
              columns={weekdays.map((w) => ({ label: w.label, paise: w.averagePaise, detail: `${w.days} days · total ${formatInr(w.totalPaise)}` }))}
            />
            <Definition>Average = total net spending on that weekday ÷ number of those weekdays in the range.</Definition>
          </Card>
        </>
      );
      break;
    }
    case "recurring": {
      body = (
        <Card title={`Recurring payments and subscriptions · ${sixMonths}`}>
          {data.recurring.length === 0 ? (
            <EmptyState>No recurring payments found. A merchant needs a similar amount in at least 3 different months.</EmptyState>
          ) : (
            <Table
              head={["Merchant", "Typical amount", "Months seen", "Last paid"]}
              rows={data.recurring.map((r) => [
                <span key="m">
                  {r.merchant}
                  <span className="block text-xs text-muted">{r.categoryId ? catName(r.categoryId) : "Uncategorized"}</span>
                </span>,
                formatInr(r.typicalPaise),
                `${r.monthsSeen} of ${r.monthsChecked}`,
                formatDate(r.lastDate),
              ])}
              foot={["Typical monthly total", formatInr(data.recurring.reduce((s, r) => s + r.typicalPaise, 0)), "", ""]}
            />
          )}
          <Definition>
            A merchant counts as recurring when it is paid an amount within 15% of its usual amount in at least 3 different months of the last six,
            and no more than about once a month. Frequent merchants such as food delivery are deliberately left out.
          </Definition>
        </Card>
      );
      break;
    }
    case "budgets": {
      const months = data.monthly.map((m) => m.month);
      const reportsByMonth = await Promise.all(months.map((m) => budgetReport(db(), user.id, m)));
      const current = reportsByMonth[reportsByMonth.length - 1];
      body = (
        <>
          <Card title={`Budget usage · ${formatMonth(current.month)}`} action={<TextLink href="/budgets">Manage budgets</TextLink>}>
            {!current.overall && current.categories.length === 0 ? (
              <EmptyState>
                No budgets in force this month. <TextLink href="/budgets">Set one</TextLink>.
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-4">
                {current.overall && <BudgetMeter label="Overall" {...current.overall} />}
                {current.categories.map((b) => (
                  <BudgetMeter key={b.categoryId} label={catName(b.categoryId!)} {...b} />
                ))}
              </div>
            )}
            <Definition>{current.definition}</Definition>
          </Card>
          <Card title={`Overall budget by month · ${sixMonths}`}>
            <Table
              head={["Month", "Net spending", "Budget", "Used"]}
              rows={reportsByMonth.map((r, i) => [
                formatMonth(r.month),
                formatInr(data.monthly[i].netSpendPaise),
                r.overall ? formatInr(r.overall.limitPaise) : "—",
                r.overall ? `${r.overall.percentUsed}%` : "—",
              ])}
            />
          </Card>
        </>
      );
      break;
    }
    case "cashflow": {
      body = (
        <Card title={`Cash flow · ${sixMonths}`}>
          <Table
            head={["Month", "Income", "Spending", "Investments", "Cash withdrawn", "Net"]}
            rows={data.monthly.map((m) => {
              const net = m.incomePaise - m.netSpendPaise - m.investmentPaise - m.cashWithdrawalPaise;
              return [
                formatMonth(m.month),
                formatInr(m.incomePaise),
                formatInr(m.netSpendPaise),
                formatInr(m.investmentPaise),
                formatInr(m.cashWithdrawalPaise),
                <span key="n" className={net < 0 ? "text-danger" : ""}>
                  {net < 0 ? "−" : ""}
                  {formatInr(Math.abs(net))}
                </span>,
              ];
            })}
          />
          <Table
            head={["Month", "Own-account transfers", "Card bills paid"]}
            rows={data.monthly.map((m) => [formatMonth(m.month), formatInr(m.internalTransferOutPaise), formatInr(m.cardSettlementPaidPaise)])}
          />
          <Definition>
            Net = income − net spending − investments − cash withdrawals. Transfers between your own accounts and card bill payments only move money
            you already have (or settle spending already counted on the card), so they are listed separately and not subtracted again.
          </Definition>
        </Card>
      );
      break;
    }
    case "investments": {
      const list = await listTransactions(db(), user.id, { types: ["investment"], from, to, pageSize: 100 });
      body = (
        <>
          <Card title={`Investment outflows by month · ${sixMonths}`}>
            <ColumnChart caption="Investment contributions per month" columns={data.monthly.map((m) => ({ label: formatMonthShort(m.month), paise: m.investmentPaise }))} />
            <Definition>Transactions of type “Investment” (SIPs, mutual funds, stocks). They are tracked separately and never counted as lifestyle spending.</Definition>
          </Card>
          <Card title={`Investments · ${rangeLabel}`}>
            {list.items.length === 0 ? (
              <EmptyState>No investments in this period.</EmptyState>
            ) : (
              <ul className="-mx-2">
                {list.items.map((t) => (
                  <TransactionRow key={t.id} t={t} categoryName={names.categoryName} accountName={names.accountName} />
                ))}
              </ul>
            )}
          </Card>
        </>
      );
      break;
    }
    case "refunds": {
      const list = await listTransactions(db(), user.id, { types: ["refund", "reversal"], from, to, pageSize: 100 });
      const unlinked = list.items.filter((t) => !t.parentTransactionId).length;
      body = (
        <Card title={`Refunds and reversals · ${rangeLabel}`}>
          <p className="mb-3 text-sm">
            {list.total} in this period, total {formatInr(list.items.reduce((s, t) => s + t.amountPaise, 0))}.{" "}
            {unlinked > 0 ? `${unlinked} not yet linked to the original payment.` : "All linked to their original payments."}
          </p>
          {list.items.length === 0 ? (
            <EmptyState>No refunds or reversals in this period.</EmptyState>
          ) : (
            <ul className="-mx-2">
              {list.items.map((t) => (
                <TransactionRow key={t.id} t={t} categoryName={names.categoryName} accountName={names.accountName} />
              ))}
            </ul>
          )}
          <Definition>
            A linked refund reduces spending in the original purchase&apos;s category, in the month the refund arrives. A linked reversal cancels the
            original payment. Unlinked ones still reduce spending and wait in the review queue.
          </Definition>
        </Card>
      );
      break;
    }
    case "coverage": {
      const counts = new Map<string, number>();
      for (const t of items) counts.set(t.captureMethod, (counts.get(t.captureMethod) ?? 0) + 1);
      body = (
        <Card title={`Capture coverage · ${rangeLabel}`}>
          <p className="rounded-xl border border-[color:var(--status-warning)] p-3 text-sm">
            <strong>Not measurable yet.</strong> Coverage compares transactions captured automatically with the transactions on your bank and card
            statements. Statement import isn&apos;t built yet (Milestone 6), so there is nothing to compare against and no coverage figure is
            shown.
          </p>
          <h3 className="mt-4 mb-2 text-sm font-semibold">How this period&apos;s transactions were recorded</h3>
          {counts.size === 0 ? (
            <EmptyState>No transactions in this period.</EmptyState>
          ) : (
            <Table head={["Origin", "Transactions"]} rows={[...counts.entries()].map(([k, n]) => [CAPTURE_LABELS[k as CaptureMethod] ?? k, n])} />
          )}
          <Definition>
            Automatic capture coverage = automatically captured eligible posted transactions ÷ all eligible posted transactions on imported statements ×
            100. Manual entries, shared receipts, sample data and statement-only recoveries never count as automatic.
          </Definition>
        </Card>
      );
      break;
    }
    case "reconciliation":
      body = (
        <Card title="Reconciliation completeness">
          <p className="rounded-xl border border-[color:var(--status-warning)] p-3 text-sm">
            <strong>Not available yet.</strong> Reconciliation needs imported bank and card statements (Milestone 6). Once they are imported, this report
            shows which statement lines are matched, missing from the tracker, or ambiguous.
          </p>
          <Definition>
            Reconciled completeness = eligible posted statement transactions accounted for after reconciliation ÷ all eligible posted statement
            transactions × 100.
          </Definition>
        </Card>
      );
      break;
    case "insights":
      body = (
        <Card title={`Unusual spending · ${formatMonth(to.slice(0, 7))}`}>
          <InsightList result={data.insights} month={to.slice(0, 7)} categoryName={names.categoryName} />
          <Definition>
            Compares net spending in days 1–N of the month with the average of the same days in each of the previous three months, overall and per
            category. Only differences of at least 25% and ₹500 are shown, and nothing is shown without three months of history.
          </Definition>
        </Card>
      );
      break;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" />
      <nav aria-label="Reports" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2 pb-1">
          {REPORTS.map(([key, label]) => (
            <li key={key}>
              <Link
                href={`/reports?${qs({ r: key })}`}
                aria-current={key === report ? "page" : undefined}
                className="block rounded-full border border-border bg-surface px-3 py-1.5 text-sm whitespace-nowrap aria-[current=page]:border-brand aria-[current=page]:bg-brand aria-[current=page]:text-brand-contrast"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="r" value={report} />
        {presets.map(([label, f, t]) => (
          <Link
            key={label}
            href={`/reports?${qs({ from: f, to: t })}`}
            aria-current={f === from && t === to ? "true" : undefined}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 aria-[current=true]:border-brand aria-[current=true]:font-semibold"
          >
            {label}
          </Link>
        ))}
        <label className="flex items-center gap-1 text-muted">
          From <input type="date" name="from" defaultValue={from} className="rounded-lg border border-border bg-surface px-2 py-1" />
        </label>
        <label className="flex items-center gap-1 text-muted">
          To <input type="date" name="to" defaultValue={to} className="rounded-lg border border-border bg-surface px-2 py-1" />
        </label>
        <button type="submit" className="rounded-lg border border-border bg-surface px-3 py-1.5 font-medium">
          Apply
        </button>
      </form>
      <SampleBanner count={items.filter((t) => t.isSample).length} />
      {body}
    </div>
  );
}
