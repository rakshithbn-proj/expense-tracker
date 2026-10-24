"use client";

import { useActionState, useState } from "react";
import { buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";

export type KeyState = { error: string | null; key: string | null; endpoint: string | null };

// Creates a Shortcut key and shows it exactly once, with the endpoint to paste into the Shortcut.
export function DeviceKeyCreator({ action }: { action: (prev: KeyState, fd: FormData) => Promise<KeyState> }) {
  const [state, formAction, pending] = useActionState(action, { error: null, key: null, endpoint: null });
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted">
          New key name
          <input name="name" required maxLength={60} placeholder="e.g. My iPhone" className={inputClass} />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.key && state.endpoint && (
        <div className="rounded-xl border border-[color:var(--status-warning)] p-3 text-sm" data-testid="new-device-key">
          <p className="mb-2 font-semibold">Copy this key now. It won&apos;t be shown again.</p>
          {[
            ["Key", state.key, "device-key-value"],
            ["Endpoint", state.endpoint, "device-key-endpoint"],
          ].map(([label, value, testId]) => (
            <div key={label} className="mb-2 flex flex-wrap items-center gap-2">
              <span className="w-20 text-muted">{label}</span>
              <input readOnly value={value} data-testid={testId} className={`${inputClass} flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className={secondaryButtonClass} onClick={() => copy(label, value)}>
                {copied === label ? "Copied" : "Copy"}
              </button>
            </div>
          ))}
          <p className="text-xs text-muted">Paste both into the Shortcut as described in docs/setup/iphone-shortcut.md.</p>
        </div>
      )}
    </div>
  );
}
