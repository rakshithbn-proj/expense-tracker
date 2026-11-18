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
import { dailyAllowance } from "@/server/finance/daily-allowance-service";
import { lookups, overview } from "@/server/finance/reports-service";
import { listReasons } from "@/server/finance/transactions-service";
import { ReasonPicker } from "./reason-picker";
import { DailyAllowanceCard } from "./daily-allowance-card";
import { chooseWhy } from "./why";

export const metadata = { title: "Overview · Expenses" };

const SPENDING_DEFINITION =
  "Net spending = purchases and fees (completed and pending) minus refunds. Own-account transfers, card bill payments, income, investments, cash withdrawals, failed and reversed payments are not spending.";

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const today = istDate(new Date());
  const currentMonth = today.slice(0, 7);
  const query = await searchParams;
  const requested = z.string().optional().parse(query.month);
  const month = requested && isValidMonth(requested) && requested <= currentMonth ? requested : currentMonth;

  const reasons = await listReasons(db(), user.id);
  // The whole page, budgets included, shows one "why".
  const { requested: requestedWhy, value: why, reason, options: whyOptions } = chooseWhy(query.why, reasons);

  const [data, names, capabilities, toExplain, allowance] = await Promise.all([
    overview(db(), user.id, month, today, reason),
    lookups(db(), user.id),
    captureCapabilities(db(), user.id),
    listToExplain(db(), user.id),
    // The daily allowance is about today, so it's shown for the current month only.
    month === currentMonth ? dailyAllowance(db(), user.id, today, reason) : Promise.resolve(null),
  ]);
  // Same evidence as the Automation page: a source counts only after it captured something real.
  const working = capabilities.filter((c) => c.mode === "Automatic" && c.lastSuccessAt !== null);
  const failing = capabilities.filter((c) => c.status === "Temporarily failing");
  const { summary } = data;
  const catName = (id: string) => (id === "uncategorized" ? "Uncategorized" : (names.categoryName.get(id) ?? "Unknown category"));
  // Links into the transactions list carry the chosen "why" so the list matches what's shown here.
  const whyQuery = reason ? `&why=${encodeURIComponent(reason)}` : "";
  const budgetsHref = `/budgets?why=${encodeURIComponent(why)}`;
  const monthQuery = `from=${month}-01&to=${month}-${String(daysInMonth(month)).padStart(2, "0")}${whyQuery}`;

  const vsPrevious = summary.netSpendPaise - data.previousSameDaysPaise;
  const prevLabel = formatMonthShort(addMonths(month, -1));
  const comparison =
    data.previousSameDaysPaise === 0 && summary.netSpendPaise === 0
      ? null
      : `${vsPrevious >= 0 ? "▲" : "▼"} ${formatInr(Math.abs(vsPrevious))} ${vsPrevious >= 0 ? "more" : "less"} than days 1–${data.throughDay} of ${prevLabel}`;

  const overall = data.budgets.overall;
  const hasAny = summary.transactionCount > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Overview">
        <ReasonPicker month={month} value={why} reasons={whyOptions} />
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
        <div id="net-spend-label" className="text-sm text-muted">
          Net spending{reason ? ` · ${reason}` : ""} · {formatMonth(month)}
          {data.isCurrent ? " so far" : ""}
        </div>
        <div className="mt-1 text-5xl font-semibold tracking-tight" data-testid="net-spending">
          {formatInrWhole(summary.netSpendPaise)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span>Spent {formatInr(summary.grossSpendPaise)}</span>
          <span>Refunds −{formatInr(summary.refundsPaise)}</span>
          {summary.pendingSpendPaise > 0 && <span>Includes {formatInr(summary.pendingSpendPaise)} pending</span>}
        </div>
        {comparison && <div className="mt-2 text-sm">{comparison}</div>}
        {reason && (
          <div className="mt-2 text-sm">
            <TextLink href={`/transactions?${monthQuery}`}>See these payments</TextLink>
          </div>
        )}
        <Definition>
          {SPENDING_DEFINITION}
          {reason
            ? ` This page, budgets included, shows only payments explained with “${reason}” (a refund counts under its purchase's reason).`
            : ""}
        </Definition>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label={reason ? `${reason} budget` : "Overall budget"}
          value={overall ? (overall.remainingPaise >= 0 ? `${formatInrWhole(overall.remainingPaise)} left` : `${formatInrWhole(-overall.remainingPaise)} over`) : "Not set"}
          detail={overall ? `${overall.percentUsed}% of ${formatInrWhole(overall.limitPaise)} used` : <TextLink href={budgetsHref}>Set a budget</TextLink>}
        />
        <StatTile
          label="Needs review"
          value={String(data.needsReviewCount)}
          detail={data.needsReviewCount > 0 ? <TextLink href={`/transactions?review=1${whyQuery}`}>Review now</TextLink> : "All clear"}
        />
        <StatTile label="Income" value={formatInrWhole(summary.incomePaise)} detail="Not counted as spending" />
        <StatTile
          label="Investments"
          value={formatInrWhole(summary.investmentPaise)}
          detail={`Cash withdrawn ${formatInrWhole(summary.cashWithdrawalPaise)}`}
        />
      </div>

      {allowance && (
        <Card title={reason ? `Daily allowance · ${reason}` : "Daily allowance"} action={<TextLink href={budgetsHref}>Budgets</TextLink>}>
          <DailyAllowanceCard allowance={{ label: reason ? `All of ${reason}` : "Overall", ...allowance }} />
          <Definition>
            Each day gets the budget not yet handed out, divided by the days left. Unspent money carries over to the next day. Spending
            more than the day&apos;s allowance closes the day at zero and lowers every later day. Refunds add back to their day. What&apos;s
            left (or overspent) at the end of a month moves to the next month. It works on the total budget across all categories; category budgets aren&apos;t split into days.
          </Definition>
        </Card>
      )}

      {!hasAny ? (
        <Card>
          <EmptyState>
            {reason ? (
              <>
                No payments explained with “{reason}” in {formatMonth(month)}. <TextLink href={`/?month=${month}&why=all`}>Show all spending</TextLink>.
              </>
            ) : (
              <>
                No transactions in {formatMonth(month)} yet. You can <TextLink href="/transactions/new">add one manually</TextLink>.
              </>
            )}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title="Spending through the month">
            <LineCompareChart
              caption={`Cumulative net spending by day: ${formatMonth(month)} compared with ${formatMonth(addMonths(month, -1))}`}
              xLabels={Array.from({ length: Math.max(data.cumulative.previous.length, data.cumulative.current.length) }, (_, i) => `Day ${i + 1}`)}
              series={[
                { name: formatMonthShort(month), values: data.cumulative.current, color: "series-1" },
                { name: formatMonthShort(addMonths(month, -1)), values: data.cumulative.previous, color: "series-compare" },
              ]}
            />
          </Card>

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

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={reason ? `Budgets · ${reason}` : "Budgets"} action={<TextLink href={budgetsHref}>Manage</TextLink>}>
              {data.budgets.categories.length === 0 && !overall ? (
                <EmptyState>
                  {reason ? `No budgets for “${reason}” yet. ` : "No budgets yet. "}
                  <TextLink href={budgetsHref}>Set monthly limits</TextLink> for {reason ? "its total" : "overall spending"} or a category.
                </EmptyState>
              ) : (
                <div className="flex flex-col gap-4">
                  {overall && <BudgetMeter label={reason ? `All of ${reason}` : "Overall"} {...overall} />}
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
