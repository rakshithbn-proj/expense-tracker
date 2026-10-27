import { z, ZodError } from "zod";
import { db } from "@/server/db/client";
import { DomainError, NotFoundError } from "@/server/errors";
import { explainTransaction, listToExplain, takeDuePrompt } from "@/server/explain/service";
import { authenticateDeviceKey } from "@/server/ingestion/shortcut/keys";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

// The iPhone "Explain payments" Shortcut. Device-key authenticated (no cookies). The key can
// read only the payments waiting to be explained and the category names, and can only answer
// those payments.
//
//   GET  /api/ingest/explain            -> { count, title, items: [{ id, label, categories }] }
//                                          (count 0 when nothing is due; ?manual=1 asks now)
//   POST /api/ingest/explain            <- { id, category, reason?, remember? }

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const device = await authenticateDeviceKey(db(), request.headers.get("authorization"));
  if (!device) return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const manual = new URL(request.url).searchParams.get("manual") === "1";
  try {
    const prompt = await takeDuePrompt(db(), device.userId, new Date(), { manual });
    if (!prompt) return Response.json({ count: 0, title: "Nothing to explain", items: [] }, { headers: noStore });
    return Response.json(
      {
        count: prompt.items.length,
        title: prompt.title,
        items: prompt.items.map((i) => ({ id: i.id, label: i.label, categories: i.categories })),
      },
      { headers: noStore },
    );
  } catch (err) {
    logger.error({ event: "explain_fetch_error", err: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: "Something went wrong; please try again" }, { status: 500, headers: noStore });
  }
}

const answerSchema = z.object({
  id: z.string().uuid(),
  category: z.string().trim().min(1).max(60),
  reason: z.string().max(500).nullish(),
  remember: z.union([z.boolean(), z.enum(["true", "false", "yes", "no"])]).optional(),
});

// `?format=text` returns just the message as plain text, for a single "Show Notification".
export async function POST(request: Request) {
  const asText = new URL(request.url).searchParams.get("format") === "text";
  const reply = (message: string, status = 200) =>
    asText
      ? new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...noStore } })
      : Response.json({ status: status < 400 ? "saved" : "error", message }, { status, headers: noStore });

  const device = await authenticateDeviceKey(db(), request.headers.get("authorization"));
  if (!device) return reply("Unauthorized", 401);
  const raw = await request.text();
  if (raw.length > 5_000) return reply("Request too large", 413);
  try {
    const body = answerSchema.parse(JSON.parse(raw));
    // The key may only answer payments that are actually waiting for an answer.
    const waiting = await listToExplain(db(), device.userId);
    if (!waiting.some((w) => w.id === body.id)) return reply("That payment isn't waiting to be explained", 404);
    const remember = body.remember === true || body.remember === "true" || body.remember === "yes";
    const t = await explainTransaction(db(), device.userId, body.id, { categoryName: body.category, reason: body.reason ?? null, remember });
    return reply(`Saved: ${body.category}${t.reason ? ` · ${t.reason}` : ""}`);
  } catch (err) {
    if (err instanceof SyntaxError) return reply("The request body must be JSON", 400);
    if (err instanceof ZodError) return reply(`${err.issues[0]?.path.join(".") || "request"}: ${err.issues[0]?.message ?? "invalid"}`, 400);
    if (err instanceof DomainError) return reply(err.message, 422);
    if (err instanceof NotFoundError) return reply("That payment isn't waiting to be explained", 404);
    logger.error({ event: "explain_answer_error", err: err instanceof Error ? err.message : String(err) });
    return reply("Something went wrong; please try again", 500);
  }
}
