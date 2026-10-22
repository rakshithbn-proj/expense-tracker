import "server-only";
import { ZodError } from "zod";
import { getCurrentUser } from "@/server/auth/dal";
import type { SessionUser } from "@/server/auth/session";
import { DomainError, NotFoundError } from "@/server/errors";
import { logger } from "@/server/logger";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Cookie-authenticated route handlers don't get Next's Server Action origin check, so writes
// must prove they come from this site (ADR-0001).
function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function apiRoute<Ctx>(handler: (args: { req: Request; user: SessionUser; ctx: Ctx }) => Promise<unknown>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      const user = await getCurrentUser();
      if (!user) return json({ error: "unauthorized" }, 401);
      if (req.method !== "GET" && req.method !== "HEAD" && !isSameOrigin(req)) {
        return json({ error: "forbidden", message: "Cross-site request rejected." }, 403);
      }
      const result = await handler({ req, user, ctx });
      if (result instanceof Response) return result;
      return json(result, req.method === "POST" ? 201 : 200);
    } catch (err) {
      if (err instanceof ZodError) {
        return json(
          { error: "invalid_request", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          400,
        );
      }
      if (err instanceof SyntaxError) return json({ error: "invalid_json" }, 400);
      if (err instanceof NotFoundError) return json({ error: "not_found", message: err.message }, 404);
      if (err instanceof DomainError) return json({ error: err.code, message: err.message }, 409);
      // No details reach the client; the log has the message but never request bodies.
      logger.error({ event: "api_error", path: new URL(req.url).pathname, err: err instanceof Error ? err.message : String(err) });
      return json({ error: "internal_error" }, 500);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json();
}

export function searchParamsObject(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams);
}

export { json };
