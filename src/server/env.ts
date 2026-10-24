import "server-only";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  // Gmail capture (optional: without these the Gmail source shows as "Not configured").
  // Empty values (e.g. from Compose's `${VAR:-}`) count as unset.
  GOOGLE_CLIENT_ID: z.string().optional().transform((v) => v?.trim() || undefined),
  GOOGLE_CLIENT_SECRET: z.string().optional().transform((v) => v?.trim() || undefined),
  // 32 random bytes, base64. Encrypts stored OAuth refresh tokens.
  TOKEN_ENCRYPTION_KEY: z.string().optional().transform((v) => v?.trim() || undefined),
  GMAIL_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  WORKER_POLL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
});

export type GmailConfig = { clientId: string; clientSecret: string; redirectUri: string; encryptionKey: Buffer; backfillDays: number };

// Returns null (Gmail "Not configured") unless every Gmail setting is present and valid.
export function gmailConfig(): GmailConfig | null {
  const e = env();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET || !e.TOKEN_ENCRYPTION_KEY) return null;
  const key = Buffer.from(e.TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return {
    clientId: e.GOOGLE_CLIENT_ID,
    clientSecret: e.GOOGLE_CLIENT_SECRET,
    redirectUri: new URL("/api/gmail/callback", e.APP_ORIGIN).toString(),
    encryptionKey: key,
    backfillDays: e.GMAIL_BACKFILL_DAYS,
  };
}

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

// Parsed lazily so `next build` doesn't need runtime secrets.
export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid environment configuration: ${fields}`);
    }
    cached = parsed.data;
  }
  return cached;
}
