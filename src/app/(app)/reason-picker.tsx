"use client";

import { useRouter } from "next/navigation";
import { inputClass } from "@/components/ui";
import { ALL_REASONS } from "./why";

// Chooses which "why" a page (Overview or Budgets) shows; keeps the month in view.
export function ReasonPicker({ month, value, reasons, basePath = "/" }: { month?: string; value: string; reasons: string[]; basePath?: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Why
      <select
        name="why"
        value={value}
        className={`${inputClass} w-auto py-1`}
        onChange={(e) => router.push(`${basePath}?${new URLSearchParams({ ...(month ? { month } : {}), why: e.target.value })}`)}
        data-testid="net-spending-why"
      >
        <option value={ALL_REASONS}>All spending</option>
        {reasons.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </label>
  );
}
