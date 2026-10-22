import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attemptLogin } from "@/server/auth/login";
import {
  LOGIN_WINDOW_MS,
  MAX_FAILURES_GLOBAL,
  MAX_FAILURES_PER_IP,
  recordLoginAttempt,
} from "@/server/auth/rate-limit";
import { createSession, hashSessionToken, invalidateSession, SESSION_TTL_MS, validateSessionToken } from "@/server/auth/session";
import { auditEvents, sessions } from "@/server/db/schema";
import { createOwner, resetPassword } from "@/server/users";
import { closeTestDb, resetDb, testDb } from "../support/db";

const EMAIL = "owner@example.com";
const PASSWORD = "a-long-test-password";
const DAY = 24 * 60 * 60 * 1000;

const login = (overrides: Partial<{ email: string; password: string; ip: string | null }> = {}) =>
  attemptLogin(testDb(), { email: EMAIL, password: PASSWORD, ip: "198.51.100.1", userAgent: "vitest", ...overrides });

beforeEach(resetDb);
afterAll(closeTestDb);

describe("owner account", () => {
  it("allows exactly one user", async () => {
    await createOwner(testDb(), EMAIL, PASSWORD);
    await expect(createOwner(testDb(), "second@example.com", PASSWORD)).rejects.toThrow(/already exists/);
  });

  it("normalizes the email", async () => {
    const user = await createOwner(testDb(), "  Owner@Example.COM ", PASSWORD);
    expect(user.email).toBe(EMAIL);
  });
});

describe("login", () => {
  beforeEach(async () => {
    await createOwner(testDb(), EMAIL, PASSWORD);
  });

  it("creates a session whose token validates", async () => {
    const result = await login({ email: "OWNER@example.com" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = await validateSessionToken(testDb(), result.token);
    expect(session?.user.email).toBe(EMAIL);
  });

  it("stores only the token hash", async () => {
    const result = await login();
    if (!result.ok) throw new Error("login failed");
    const rows = await testDb().select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(hashSessionToken(result.token));
    expect(rows[0].id).not.toBe(result.token);
  });

  it("rejects a wrong password and an unknown email with the same reason", async () => {
    expect(await login({ password: "wrong-password-123" })).toEqual({ ok: false, reason: "invalid" });
    expect(await login({ email: "nobody@example.com" })).toEqual({ ok: false, reason: "invalid" });
  });

  it("blocks an IP after repeated failures, even with the right password", async () => {
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) await login({ password: "wrong-password-123" });
    expect(await login()).toEqual({ ok: false, reason: "rate_limited" });
    // A different IP is unaffected.
    expect((await login({ ip: "198.51.100.2" })).ok).toBe(true);
  });

  it("blocks all logins after too many failures from many IPs", async () => {
    for (let i = 0; i < MAX_FAILURES_GLOBAL; i++) await recordLoginAttempt(testDb(), `203.0.113.${i + 1}`, false);
    expect(await login({ ip: "192.0.2.50" })).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("forgets failures older than the window", async () => {
    const old = new Date(Date.now() - LOGIN_WINDOW_MS - 1000);
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) await recordLoginAttempt(testDb(), "198.51.100.1", false, old);
    expect((await login()).ok).toBe(true);
  });

  it("writes an audit event without credentials", async () => {
    await login();
    const events = await testDb().select().from(auditEvents).where(eq(auditEvents.action, "login"));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toContain(PASSWORD);
  });
});

describe("sessions", () => {
  let userId: string;
  beforeEach(async () => {
    userId = (await createOwner(testDb(), EMAIL, PASSWORD)).id;
  });

  it("expire after their lifetime", async () => {
    const start = new Date();
    const { token } = await createSession(testDb(), userId, null, start);
    const later = new Date(start.getTime() + SESSION_TTL_MS + 1000);
    expect(await validateSessionToken(testDb(), token, later)).toBeNull();
    expect(await testDb().select().from(sessions)).toHaveLength(0);
  });

  it("slide forward when used in the second half of their lifetime", async () => {
    const start = new Date();
    const { token, expiresAt } = await createSession(testDb(), userId, null, start);
    const early = await validateSessionToken(testDb(), token, new Date(start.getTime() + 1 * DAY));
    expect(early?.expiresAt.getTime()).toBe(expiresAt.getTime());
    const lateNow = new Date(start.getTime() + 20 * DAY);
    const late = await validateSessionToken(testDb(), token, lateNow);
    expect(late?.expiresAt.getTime()).toBe(lateNow.getTime() + SESSION_TTL_MS);
  });

  it("stop working after logout", async () => {
    const { token } = await createSession(testDb(), userId, null);
    await invalidateSession(testDb(), token);
    expect(await validateSessionToken(testDb(), token)).toBeNull();
  });

  it("are all revoked by a password reset", async () => {
    const a = await createSession(testDb(), userId, null);
    const b = await createSession(testDb(), userId, null);
    await resetPassword(testDb(), EMAIL, "a-brand-new-password");
    expect(await validateSessionToken(testDb(), a.token)).toBeNull();
    expect(await validateSessionToken(testDb(), b.token)).toBeNull();
    expect((await login()).ok).toBe(false);
    expect((await login({ password: "a-brand-new-password" })).ok).toBe(true);
  });

  it("reject a random token", async () => {
    expect(await validateSessionToken(testDb(), "made-up-token")).toBeNull();
  });
});
