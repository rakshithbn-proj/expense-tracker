"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded-xl border border-border bg-surface px-3.5 py-3 text-base outline-none focus:border-brand"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-xl border border-border bg-surface px-3.5 py-3 text-base outline-none focus:border-brand"
        />
      </label>
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-danger">
        {state.error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-brand px-4 py-3 text-base font-semibold text-brand-contrast disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
