import Link from "next/link";
import { z } from "zod";
import { BarList } from "@/components/charts/bar-list";
import { BudgetMeter } from "@/components/charts/budget-meter";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineCompareChart } from "@/components/charts/line-compare";
import { PieChart } from "@/components/charts/pie-chart";
import { InsightList } from "@/components/insight-list";
import { MonthNav } from "@/components/month-nav";
import { TransactionRow } from "@/components/transaction-row";
import { Card, Definition, EmptyState, PageHeader, SampleBanner, StatTile, TextLink } from "@/components/ui";
import { addMonths, istDate, isValidMonth } from "@/lib/dates";
import { CAPTURE_LABELS, formatInr, formatInrWhole, formatMonth, formatMonthShort, METHOD_LABELS } from "@/lib/format";
import type { CaptureMethod, PaymentMethod } from "@/lib/finance-types";
import { requireUser } from "@/server/auth/dal";
import { captureCapabilities } from "@/server/capture/capabilities";
import { listToExplain } from "@/server/explain/service";
import { db } from "@/server/db/client";
import { daysInMonth } from "@/server/finance/analytics";
import { lookups, overview } from "@/server/finance/reports-service";
import { listReasons } from "@/server/finance/transactions-service";
import { ReasonPicker } from "./reason-picker";

export const metadata = { title: "Overview · Expenses" };

const SPENDING_DEFINITION =
  "Net spending = purchases and fees (completed and pending) minus refunds. Own-account transfers, card bill payments, income, investments, cash withdrawals, failed and reversed payments are not spending.";

// Net spending defaults to this "why" when the user has used it; "all" means every payment.
const DEFAULT_REASON = "shared rental expense";
const ALL_REASONS = "all";

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const today = istDate(new Date());
  const currentMonth = today.slice(0, 7);
  const query = await searchParams;
  const requested = z.string().optional().parse(query.month);
  const month = requested && isValidMonth(requested) && requested <= currentMonth ? requested : currentMonth;

  const reasons = await listReasons(db(), user.id);
  const requestedWhy = z.string().max(500).optional().catch(undefined).parse(query.why);
  const why = requestedWhy ?? reasons.find((r) => r.toLowerCase() === DEFAULT_REASON) ?? ALL_REASONS;
  const reason = why === ALL_REASONS ? null : why;

  const [data, names, capabilities, toExplain] = await Promise.all([
    overview(db(), user.id, month, today, reason),
    lookups(db(), user.id),
    captureCapabilities(db(), user.id),
    listToExplain(db(), user.id),
  ]);
  // Same evidence as the Automation page: a source counts only after it captured something real.
  const working = capabilities.filter((c) => c.mode === "Automatic" && c.lastSuccessAt !== null);
  const failing = capabilities.filter((c) => c.status === "Temporarily failing");
  const { summary } = data;
  const catName = (id: string) => (id === "uncategorized" ? "Uncategorized" : (names.categoryName.get(id) ?? "Unknown category"));
  const monthQuery = `from=${month}-01&to=${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

  const net = data.netSpending;
  const vsPrevious = net.summary.netSpendPaise - net.previousSameDaysPaise;
  const prevLabel = formatMonthShort(addMonths(month, -1));
  const comparison =
    net.previousSameDaysPaise === 0 && net.summary.netSpendPaise === 0
      ? null
      : `${vsPrevious >= 0 ? "▲" : "▼"} ${formatInr(Math.abs(vsPrevious))} ${vsPrevious >= 0 ? "more" : "less"} than days 1–${data.throughDay} of ${prevLabel}`;

  const overall = data.budgets.overall;
  const hasAny = summary.transactionCount > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Overview">
        <MonthNav month={month} currentMonth={currentMonth} basePath="/" keep={requestedWhy ? { why: requestedWhy } : {}} />
      </PageHeader>
      <SampleBanner count={data.sampleCount} />
      {toExplain.length > 0 && (
        <Link
          href="/explain"
          className="flex items-center justify-between gap-3 rounded-xl border border-brand bg-surface px-4 py-3 text-sm font-medium"
          data-testid="to-explain-banner"
        >
          <span>
            {toExplain.length} payment{toExplain.length === 1 ? "" : "s"} to explain
          </span>
          <span aria-hidden>›</span>
        </Link>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="net-spend-label">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div id="net-spend-label" className="text-sm text-muted">
            Net spending{reason ? ` · ${reason}` : ""} · {formatMonth(month)}
            {data.isCurrent ? " so far" : ""}
          </div>
          <ReasonPicker month={month} value={why} reasons={reason && !reasons.includes(reason) ? [...reasons, reason] : reasons} />
        </div>
        <div className="mt-1 text-5xl font-semibold tracking-tight" data-testid="net-spending">
          {formatInrWhole(net.summary.netSpendPaise)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span>Spent {formatInr(net.summary.grossSpendPaise)}</span>
          <span>Refunds −{formatInr(net.summary.refundsPaise)}</span>
          {net.summary.pendingSpendPaise > 0 && <span>Includes {formatInr(net.summary.pendingSpendPaise)} pending</span>}
        </div>
        {comparison && <div className="mt-2 text-sm">{comparison}</div>}
        {reason && (
          <div className="mt-2 text-sm">
            <TextLink href={`/transactions?${monthQuery}&why=${encodeURIComponent(reason)}`}>See these payments</TextLink>
          </div>
        )}
        <Definition>
          {SPENDING_DEFINITION}
          {reason ? ` Only payments explained with “${reason}” count here (a refund counts under its purchase's reason); the rest of this page covers all spending.` : ""}
        </Definition>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Overall budget"
          value={overall ? (overall.remainingPaise >= 0 ? `${formatInrWhole(overall.remainingPaise)} left` : `${formatInrWhole(-overall.remainingPaise)} over`) : "Not set"}
          detail={overall ? `${overall.percentUsed}% of ${formatInrWhole(overall.limitPaise)} used` : <TextLink href="/budgets">Set a budget</TextLink>}
        />
        <StatTile
          label="Needs review"
          value={String(data.needsReviewCount)}
          detail={data.needsReviewCount > 0 ? <TextLink href="/transactions?review=1">Review now</TextLink> : "All clear"}
        />
        <StatTile label="Income" value={formatInrWhole(summary.incomePaise)} detail="Not counted as spending" />
        <StatTile
          label="Investments"
          value={formatInrWhole(summary.investmentPaise)}
          detail={`Cash withdrawn ${formatInrWhole(summary.cashWithdrawalPaise)}`}
        />
      </div>

      {!hasAny ? (
        <Card>
          <EmptyState>
            No transactions in {formatMonth(month)} yet. Automatic capture arrives in Milestones 4–6. Until then you can{" "}
            <TextLink href="/transactions/new">add one manually</TextLink>.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title={reason ? "All spending through the month" : "Spending through the month"}>
            <LineCompareChart
              caption={`Cumulative net spending by day: ${formatMonth(month)} compared with ${formatMonth(addMonths(month, -1))}`}
              xLabels={Array.from({ length: Math.max(data.cumulative.previous.length, data.cumulative.current.length) }, (_, i) => `Day ${i + 1}`)}
              series={[
                { name: formatMonthShort(month), values: data.cumulative.current, color: "series-1" },
                { name: formatMonthShort(addMonths(month, -1)), values: data.cumulative.previous, color: "series-compare" },
              ]}
            />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="By category" action={<TextLink href="/reports?r=category">Report</TextLink>}>
              <PieChart
                caption={`Net spending by category in ${formatMonth(month)}`}
                items={data.byCategory.map((g) => ({
                  key: g.key,
                  label: catName(g.key),
                  paise: g.paise,
                  detail: `${g.count} transaction${g.count === 1 ? "" : "s"}`,
                  href: `/transactions?${monthQuery}&category=${g.key}`,
                }))}
              />
            </Card>

            <Card title="Budgets" action={<TextLink href="/budgets">Manage</TextLink>}>
              {data.budgets.categories.length === 0 && !overall ? (
                <EmptyState>
                  No budgets yet. <TextLink href="/budgets">Set monthly limits</TextLink> for overall spending or a category.
                </EmptyState>
              ) : (
                <div className="flex flex-col gap-4">
                  {overall && <BudgetMeter label="Overall" {...overall} />}
                  {data.budgets.categories.map((b) => (
                    <BudgetMeter key={b.categoryId} label={catName(b.categoryId!)} {...b} />
                  ))}
                </div>
              )}
            </Card>

            <Card title="Insights">
              <InsightList result={data.insights} month={month} categoryName={names.categoryName} />
            </Card>

            <Card title="Top merchants" action={<TextLink href="/reports?r=merchant">Report</TextLink>}>
              <BarList items={data.topMerchants.map((g) => ({ key: g.key, label: data.merchantDisplay.get(g.key) ?? g.key, paise: g.paise }))} />
            </Card>

            <Card title="By payment method" action={<TextLink href="/reports?r=method">Report</TextLink>}>
              <BarList items={data.byPaymentMethod.map((g) => ({ key: g.key, label: METHOD_LABELS[g.key as PaymentMethod] ?? g.key, paise: g.paise }))} />
            </Card>

            <Card title="By day of the week">
              <ColumnChart
                caption={`Net spending by weekday in ${formatMonth(month)}`}
                columns={data.weekdays.map((w) => ({
                  label: w.label,
                  paise: w.totalPaise,
                  detail: `${w.days} ${w.label} so far · average ${formatInr(w.averagePaise)} a day`,
                }))}
              />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Recent transactions" action={<TextLink href={`/transactions?${monthQuery}`}>See all</TextLink>}>
              <ul className="-mx-2">
                {data.recent.map((t) => (
                  <TransactionRow key={t.id} t={t} categoryName={names.categoryName} accountName={names.accountName} />
                ))}
              </ul>
            </Card>
            <Card title="Refunds and reversals">
              {data.refundsAndReversals.length === 0 ? (
                <EmptyState>No refunds or reversals this month.</EmptyState>
              ) : (
                <ul className="-mx-2">
                  {data.refundsAndReversals.map((t) => (
                    <TransactionRow key={t.id} t={t} categoryName={names.categoryName} accountName={names.accountName} />
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <Card title="Capture sources" action={<TextLink href="/automation">Details</TextLink>}>
        <p className="text-sm" data-testid="capture-summary">
          {working.length === 0
            ? "No automatic source has captured a real transaction yet. Connect Gmail or set up the iPhone SMS Shortcut in Automation."
            : `Capturing automatically: ${working.map((c) => c.name).join(", ")}.`}
        </p>
        {failing.length > 0 && (
          <p className="mt-2 text-sm text-danger">
            {failing.length} source{failing.length === 1 ? " is" : "s are"} failing right now. See Automation.
          </p>
        )}
        {hasAny && (
          <p className="mt-2 text-xs text-muted">
            This month&apos;s transactions by origin:{" "}
            {Object.entries(data.captureMethods)
              .map(([k, n]) => `${CAPTURE_LABELS[k as CaptureMethod]} ${n}`)
              .join(" · ")}
          </p>
        )}
      </Card>
    </div>
  );
}
