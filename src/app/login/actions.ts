"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db/client";
import { attemptLogin } from "@/server/auth/login";
import { requestMeta, setSessionCookie } from "@/server/auth/dal";
import { logger } from "@/server/logger";

export type LoginState = { error: string | null };

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
});

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter your email and password." };

  const meta = await requestMeta();
  const result = await attemptLogin(db(), { ...parsed.data, ...meta });

  if (!result.ok) {
    logger.warn({ event: "login_failed", reason: result.reason });
    return {
      error:
        result.reason === "rate_limited"
          ? "Too many failed attempts. Try again in 15 minutes."
          : "Incorrect email or password.",
    };
  }

  await setSessionCookie(result.token, result.expiresAt);
  redirect("/");
}
