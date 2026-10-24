import { ZodError } from "zod";
import { db } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { authenticateDeviceKey, isRateLimited } from "@/server/ingestion/shortcut/keys";
import { submitFromDevice } from "@/server/ingestion/shortcut/service";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 20_000;
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

// Receives transactions from the user's iPhone Shortcuts. Authenticated only by a device key
// (Authorization: Bearer etk_...), never by the browser session; no cookies are involved.
export async function POST(request: Request) {
  const device = await authenticateDeviceKey(db(), request.headers.get("authorization"));
  if (!device) return reply({ status: "error", message: "Unauthorized" }, 401);
  if (await isRateLimited(db(), device.keyId)) {
    return reply({ status: "error", message: "Too many submissions from this key in the last hour" }, 429, { "Retry-After": "600" });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return reply({ status: "error", message: "Request too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ status: "error", message: "The request body must be JSON" }, 400);
  }

  try {
    const result = await submitFromDevice(db(), device, body);
    return reply(result, result.status === "queued" ? 202 : 200);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply({ status: "error", message: first ? `${first.path.join(".") || "request"}: ${first.message}` : "Invalid request" }, 400);
    }
    if (err instanceof DomainError) return reply({ status: "error", message: err.message }, 422);
    logger.error({ event: "shortcut_ingest_error", err: err instanceof Error ? err.message : String(err) });
    return reply({ status: "error", message: "Something went wrong; please try again" }, 500);
  }
}
