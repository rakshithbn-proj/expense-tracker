import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/action-form";
import { TransactionRow } from "@/components/transaction-row";
import { Badge, buttonClass, Card, Definition, inputClass, secondaryButtonClass } from "@/components/ui";
import { ALLOWED_DIRECTIONS, PAYMENT_METHODS, TRANSACTION_TYPES } from "@/lib/finance-types";
import {
  CAPTURE_LABELS,
  formatDate,
  formatDateTime,
  formatSignedInr,
  METHOD_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
} from "@/lib/format";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { lookups } from "@/server/finance/reports-service";
import { getTransaction, suggestLinks, transactionHistory } from "@/server/finance/transactions-service";
import { sourceForTransaction } from "@/server/ingestion/gmail/service";
import { correctAction, linkAction, unlinkAction, voidAction } from "../actions";

export const metadata = { title: "Transaction · Expenses" };

const CATEGORY_SOURCE: Record<string, string> = { rule: "set by a rule", user: "set by you", type_default: "default for this type" };

const HISTORY_LABELS: Record<string, string> = {
  create: "Recorded",
  correct: "Corrected",
  void: "Voided",
  link_refund: "Linked as refund",
  link_reversal: "Linked as reversal",
  link_transfer: "Paired as transfer",
  unlink: "Unlinked",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-t border-border py-2 text-sm first:border-t-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

export default async function TransactionPage({ params }: PageProps<"/transactions/[id]">) {
  const user = await requireUser();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();

  let detail;
  try {
    detail = await getTransaction(db(), user.id, id.data);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const [names, suggestions, history, sources] = await Promise.all([
    lookups(db(), user.id),
    suggestLinks(db(), user.id, id.data),
    transactionHistory(db(), user.id, id.data),
    sourceForTransaction(db(), user.id, id.data),
  ]);
  const t = detail.transaction;
  const voided = !!t.voidedAt;
  const linked = !!(t.parentTransactionId || t.transferGroupId);
  const allowedTypes = TRANSACTION_TYPES.filter((type) => ALLOWED_DIRECTIONS[type].includes(t.direction));
  const row = (x: typeof t) => <TransactionRow key={x.id} t={x} categoryName={names.categoryName} accountName={names.accountName} />;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/transactions" className="text-sm text-muted hover:underline">
        ‹ Transactions
      </Link>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold break-words">{t.merchantName ?? t.originalDescription ?? TYPE_LABELS[t.transactionType]}</h1>
            <p className="mt-1 text-sm text-muted">{formatDate(t.transactionDate)}</p>
          </div>
          <div className={`text-3xl font-semibold tabular-nums ${t.direction === "credit" ? "text-success" : ""}`} data-testid="detail-amount">
            {formatSignedInr(t.amountPaise, t.direction)}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{TYPE_LABELS[t.transactionType]}</Badge>
          <Badge tone={t.transactionStatus === "posted" ? "neutral" : "info"}>{STATUS_LABELS[t.transactionStatus]}</Badge>
          {t.needsReview && <Badge tone="attention">Needs review: {t.reviewReason}</Badge>}
          {t.isSample && <Badge>Sample data</Badge>}
          {voided && <Badge tone="danger">Voided</Badge>}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Details">
          <dl>
            <Fact label="Category">
              {t.categoryId ? names.categoryName.get(t.categoryId) : "Uncategorized"}
              {t.transactionType === "refund" && t.parentTransactionId ? (
                <span className="block text-xs text-muted">same as the original purchase</span>
              ) : (
                t.categorySource && <span className="block text-xs text-muted">{CATEGORY_SOURCE[t.categorySource]}</span>
              )}
            </Fact>
            <Fact label="Account">{t.financialAccountId ? names.accountName.get(t.financialAccountId) : "Unknown"}</Fact>
            <Fact label="Payment method">{METHOD_LABELS[t.paymentMethod]}</Fact>
            <Fact label="Payment app">{t.paymentApp ?? <span className="text-muted">Not known</span>}</Fact>
            <Fact label="Reference">{t.referenceId ?? <span className="text-muted">None</span>}</Fact>
            {t.originalDescription && <Fact label="Original description">{t.originalDescription}</Fact>}
            {t.reason && <Fact label="Why">{t.reason}</Fact>}
            {t.notes && <Fact label="Notes">{t.notes}</Fact>}
          </dl>
        </Card>

        <Card title="Where it came from">
          <dl>
            <Fact label="Captured by">{CAPTURE_LABELS[t.captureMethod]}</Fact>
            <Fact label="Captured at">{formatDateTime(t.capturedAt)}</Fact>
            <Fact label="Payment time (from source)">{t.sourceTimestamp ? formatDateTime(t.sourceTimestamp) : <span className="text-muted">Not provided</span>}</Fact>
          </dl>
          {sources.map((s) => {
            const payload = (s.payload ?? {}) as { from?: string; subject?: string };
            return (
              <dl key={s.id} className="mt-2 border-t border-border pt-2">
                <Fact label="Source">{s.sourceType === "gmail" ? `Gmail (${s.sourceIdentifier})` : s.sourceType}</Fact>
                {payload.subject && <Fact label="Email">{payload.subject}</Fact>}
                {payload.from && <Fact label="From">{payload.from}</Fact>}
                {s.parserId && <Fact label="Read by">{s.parserId}</Fact>}
                {s.receivedAt && <Fact label="Email arrived">{formatDateTime(s.receivedAt.toISOString())}</Fact>}
                {s.processedAt && <Fact label="Processed">{formatDateTime(s.processedAt.toISOString())}</Fact>}
                {s.matchStatus && s.matchStatus !== "created" && (
                  <Fact label="Matching">{s.matchStatus === "matched_existing" ? "Matched an existing transaction" : "Possible duplicate"}</Fact>
                )}
              </dl>
            );
          })}
          <Definition>
            Only automatic captures (bank email, SMS) count toward automatic capture coverage. Manual entries, shared receipts, statement imports and
            sample data never do.
          </Definition>
        </Card>
      </div>

      {(detail.parent || detail.children.length > 0 || detail.transferCounterpart) && (
        <Card title="Linked transactions">
          <ul className="-mx-2">
            {detail.parent && row(detail.parent)}
            {detail.children.map(row)}
            {detail.transferCounterpart && row(detail.transferCounterpart)}
          </ul>
          {!voided && linked && (
            <ActionForm action={unlinkAction} submitLabel="Unlink" buttonClassName={secondaryButtonClass} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="id" value={t.id} />
            </ActionForm>
          )}
        </Card>
      )}

      {!voided && suggestions.refundCandidates.length > 0 && (
        <Card title={`Which purchase does this ${t.transactionType} undo?`}>
          <ul className="flex flex-col gap-3">
            {suggestions.refundCandidates.map((c) => (
              <li key={c.id} className="rounded-xl border border-border p-2">
                <ul className="-mx-2">{row(c.transaction)}</ul>
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <span className="text-xs text-muted">Matches: {c.reasons.join(", ")}</span>
                  <ActionForm action={linkAction} submitLabel="Link to this" buttonClassName={secondaryButtonClass}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="targetId" value={c.id} />
                    <input type="hidden" name="kind" value={t.transactionType} />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!voided && suggestions.transferCandidates.length > 0 && (
        <Card title="Is this a transfer between your own accounts?">
          <p className="mb-2 text-sm text-muted">
            These have the same amount, the opposite direction and another of your accounts, within 3 days. Pairing them removes both from spending.
          </p>
          <ul className="flex flex-col gap-3">
            {suggestions.transferCandidates.map((c) => (
              <li key={c.id} className="rounded-xl border border-border p-2">
                <ul className="-mx-2">{row(c)}</ul>
                <div className="flex justify-end px-1">
                  <ActionForm action={linkAction} submitLabel="Pair as transfer" buttonClassName={secondaryButtonClass}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="targetId" value={c.id} />
                    <input type="hidden" name="kind" value="transfer" />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!voided && (
        <Card title="Correct">
          <ActionForm action={correctAction} submitLabel="Save changes" buttonClassName={buttonClass} testId="correct-form">
            <input type="hidden" name="id" value={t.id} />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Category
                <select name="categoryId" defaultValue={t.categoryId ?? ""} className={inputClass}>
                  <option value="">Uncategorized</option>
                  {names.categories
                    .filter((c) => c.isActive || c.id === t.categoryId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Merchant
                <input name="merchantName" defaultValue={t.merchantName ?? ""} className={inputClass} maxLength={200} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Type
                <select name="transactionType" defaultValue={t.transactionType} className={inputClass} disabled={linked}>
                  {allowedTypes.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                {linked && <span className="font-normal">Unlink first to change the type.</span>}
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Payment method
                <select name="paymentMethod" defaultValue={t.paymentMethod} className={inputClass}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Account
                <select name="financialAccountId" defaultValue={t.financialAccountId ?? ""} className={inputClass}>
                  <option value="">Unknown</option>
                  {[...names.accountName.entries()].map(([aid, label]) => (
                    <option key={aid} value={aid}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Why was this?
                <input name="reason" defaultValue={t.reason ?? ""} className={inputClass} maxLength={500} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Notes
                <input name="notes" defaultValue={t.notes ?? ""} className={inputClass} maxLength={2000} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="markReviewed" defaultChecked={t.needsReview} className="h-4 w-4" />
              Mark as reviewed
            </label>
            {t.merchantName && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="createRule" className="h-4 w-4" />
                Always use this category for “{t.merchantName}”
              </label>
            )}
          </ActionForm>
        </Card>
      )}

      <Card title="History">
        <ol className="flex flex-col gap-2 text-sm">
          {history.map((h, i) => {
            const meta = h.metadata as Record<string, string | null>;
            return (
              <li key={i} className="flex justify-between gap-3 border-t border-border pt-2 first:border-t-0 first:pt-0">
                <span>
                  {HISTORY_LABELS[h.action] ?? h.action}
                  {meta.changed ? <span className="text-muted"> · {meta.changed.split(",").join(", ")}</span> : null}
                  {meta.reason ? <span className="text-muted"> · “{meta.reason}”</span> : null}
                  {meta.how === "auto" ? <span className="text-muted"> · automatically</span> : null}
                </span>
                <span className="shrink-0 text-xs text-muted">{formatDateTime(h.createdAt.toISOString())}</span>
              </li>
            );
          })}
        </ol>
      </Card>

      {!voided && (
        <Card title="Void">
          <p className="mb-3 text-sm text-muted">
            Voiding removes this from every list and total but keeps it, and this history, in the database. Use it for duplicates or mistakes.
          </p>
          <ActionForm action={voidAction} submitLabel="Void transaction" pendingLabel="Voiding…" buttonClassName={secondaryButtonClass} className="flex flex-col gap-3 md:flex-row md:items-end">
            <input type="hidden" name="id" value={t.id} />
            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted">
              Reason
              <input name="reason" required maxLength={200} className={inputClass} placeholder="e.g. entered twice" />
            </label>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
