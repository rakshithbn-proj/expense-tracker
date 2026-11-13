"use client";

import { useEffect, useRef, useState } from "react";
import { inputClass } from "@/components/ui";

// A select-like field that opens a list of checkboxes. The checkboxes are ordinary form inputs
// (one parameter per ticked box), so the surrounding GET form submits them as usual.
export function CheckboxDropdown({ name, label, values, options }: { name: string; label: string; values: string[]; options: [string, string][] }) {
  const [checked, setChecked] = useState(() => new Set(values));
  const ref = useRef<HTMLDetailsElement>(null);

  // Close when tapping outside or pressing Escape, like a native select.
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  const chosen = options.filter(([v]) => checked.has(v));
  const summary = chosen.length === 0 ? "Any" : chosen.length === 1 ? chosen[0][1] : `${chosen.length} selected`;
  const toggle = (v: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(v);
      else next.delete(v);
      return next;
    });

  return (
    <div className="flex flex-col gap-1 text-xs font-medium text-muted">
      <span id={`${name}-label`}>{label}</span>
      <details ref={ref} className="relative">
        <summary
          aria-labelledby={`${name}-label`}
          className={`${inputClass} flex cursor-pointer list-none items-center justify-between gap-2 font-normal text-foreground [&::-webkit-details-marker]:hidden`}
          data-testid={`${name}-dropdown`}
        >
          <span className="truncate">{summary}</span>
          <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M2.5 4.5 6 8l3.5-3.5" />
          </svg>
        </summary>
        <fieldset className="absolute z-20 mt-1 flex max-h-72 w-full min-w-56 flex-col overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg">
          <legend className="sr-only">{label}</legend>
          {options.length === 0 && <span className="px-2 py-2 text-sm font-normal">Nothing to choose yet</span>}
          {options.map(([v, l]) => (
            <label key={v} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm font-normal text-foreground hover:bg-background">
              <input type="checkbox" name={name} value={v} checked={checked.has(v)} onChange={(e) => toggle(v, e.target.checked)} className="h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{l}</span>
            </label>
          ))}
          <div className="mt-1 flex justify-between gap-2 border-t border-border pt-1">
            <button
              type="button"
              className="rounded-lg px-2 py-2 text-sm font-normal text-brand hover:bg-background disabled:opacity-40"
              disabled={chosen.length === 0}
              onClick={() => setChecked(new Set())}
            >
              Clear
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-brand hover:bg-background"
              onClick={() => {
                if (ref.current) ref.current.open = false;
              }}
            >
              Done
            </button>
          </div>
        </fieldset>
      </details>
    </div>
  );
}
