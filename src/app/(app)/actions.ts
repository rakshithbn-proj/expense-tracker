"use server";

import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { recordAudit } from "@/server/audit";
import { clearSessionCookie, getCurrentUser, getSessionToken } from "@/server/auth/dal";
import { invalidateSession } from "@/server/auth/session";

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  const token = await getSessionToken();
  if (token) await invalidateSession(db(), token);
  if (user) {
    await recordAudit(db(), { userId: user.id, entityType: "user", entityId: user.id, action: "logout" });
  }
  await clearSessionCookie();
  redirect("/login");
}
