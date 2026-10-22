import "server-only";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
});

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
