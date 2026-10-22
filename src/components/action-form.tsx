"use client";

import { useActionState, type ReactNode } from "react";

export type ActionState = { error: string | null; ok: string | null };
export const idleState: ActionState = { error: null, ok: null };

// A form bound to a server action that reports success or a readable error in place.
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving…",
  className = "flex flex-col gap-3",
  buttonClassName,
  testId,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  buttonClassName: string;
  testId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className={className} data-testid={testId}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClassName}>
          {pending ? pendingLabel : submitLabel}
        </button>
        <span role="status" aria-live="polite" className={`text-sm ${state.error ? "text-danger" : "text-success"}`}>
          {state.error ?? state.ok}
        </span>
      </div>
    </form>
  );
}
