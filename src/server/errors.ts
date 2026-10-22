// Errors whose messages are safe to show the signed-in user. Anything else becomes a
// generic 500 with no details.
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
  }
}

// PostgreSQL unique_violation. Drizzle wraps driver errors, so check the cause too.
export function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) => (e as { code?: string } | null)?.code;
  return code(err) === "23505" || code((err as { cause?: unknown } | null)?.cause) === "23505";
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
