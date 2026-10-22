import Link from "next/link";
import type { ReactNode } from "react";

export function Card({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-4 md:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action && <div className="text-sm">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

// A figure tile. Text stays in ink colours; colour never carries the meaning alone.
export function StatTile({ label, value, detail }: { label: string; value: string; detail?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {detail && <div className="mt-1 text-xs text-muted">{detail}</div>}
    </div>
  );
}

const badgeTones = {
  neutral: "border-border text-muted",
  attention: "border-[color:var(--status-warning)] text-foreground",
  danger: "border-[color:var(--status-critical)] text-foreground",
  info: "border-series-1 text-foreground",
} as const;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">{children}</p>;
}

// Shown whenever a view includes seeded sample data, so it's never mistaken for real spending.
export function SampleBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div role="note" className="mb-4 rounded-xl border border-[color:var(--status-warning)] bg-surface px-4 py-3 text-sm">
      <strong>Sample data:</strong> {count} transaction{count === 1 ? "" : "s"} shown here {count === 1 ? "is" : "are"} synthetic
      development data, not real spending. Remove with <code>npm run db:seed:sample -- --remove</code>.
    </div>
  );
}

// Every figure states which transactions it includes.
export function Definition({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-muted">{children}</p>;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-brand underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

export const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-brand md:text-sm";
export const buttonClass =
  "inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-brand-contrast disabled:opacity-60";
export const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium disabled:opacity-60";
