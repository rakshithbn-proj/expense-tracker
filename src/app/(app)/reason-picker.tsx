"use client";

import { useRouter } from "next/navigation";
import { inputClass } from "@/components/ui";

const ALL_REASONS = "all"; // same value the overview page reads

// Chooses which "why" the overview's net spending counts; keeps the month in view.
export function ReasonPicker({ month, value, reasons }: { month: string; value: string; reasons: string[] }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Why
      <select
        name="why"
        value={value}
        className={`${inputClass} w-auto py-1`}
        onChange={(e) => router.push(`/?${new URLSearchParams({ month, why: e.target.value })}`)}
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
