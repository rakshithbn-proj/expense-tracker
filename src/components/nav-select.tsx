"use client";

import { useRouter } from "next/navigation";
import { inputClass } from "@/components/ui";

// A dropdown whose options are links: picking one navigates to its href.
export function NavSelect({ label, value, options }: { label: string; value: string; options: { href: string; label: string }[] }) {
  const router = useRouter();
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
      {label}
      <select aria-label={label} value={value} onChange={(e) => router.push(e.target.value)} className={`${inputClass} text-foreground`}>
        {!options.some((o) => o.href === value) && <option value={value}>Custom range</option>}
        {options.map((o) => (
          <option key={o.href} value={o.href}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
