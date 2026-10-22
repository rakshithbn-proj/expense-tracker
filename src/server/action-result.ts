import "server-only";
import { ZodError } from "zod";
import type { ActionState } from "@/components/action-form";
import { MoneyParseError, parseAmountToPaise } from "@/lib/money";
import { DomainError, NotFoundError } from "@/server/errors";

// Runs a server action body and turns expected failures into a message for the form.
// Call redirect() outside this wrapper: it works by throwing.
export async function runAction(fn: () => Promise<string>): Promise<ActionState> {
  try {
    return { error: null, ok: await fn() };
  } catch (err) {
    if (err instanceof DomainError || err instanceof NotFoundError) return { error: err.message, ok: null };
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return { error: first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Invalid input.", ok: null };
    }
    throw err;
  }
}

export function formString(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
}

// "" means "cleared" for optional fields; a missing field stays undefined (unchanged).
export function formNullable(fd: FormData, key: string): string | null | undefined {
  const v = formString(fd, key);
  return v === undefined ? undefined : v.trim() === "" ? null : v.trim();
}

export function rupeesToPaise(value: string | undefined): number {
  try {
    const paise = parseAmountToPaise(value ?? "");
    if (paise > 0) return paise;
  } catch (err) {
    if (!(err instanceof MoneyParseError)) throw err;
  }
  throw new DomainError("invalid_amount", "Enter an amount greater than zero, with at most 2 decimal places.");
}
