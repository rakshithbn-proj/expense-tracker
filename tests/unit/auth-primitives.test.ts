import { describe, expect, it } from "vitest";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/server/auth/password";
import { normalizeIp } from "@/server/auth/rate-limit";
import { generateSessionToken, hashSessionToken } from "@/server/auth/session";
import { validateNewPassword } from "@/server/users";

describe("password hashing", () => {
  it("produces argon2id hashes that verify only the right password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong horse battery")).toBe(false);
  });

  it("treats a malformed stored hash as a failed check, not a crash", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });

  it("runs a dummy check for unknown users without throwing", async () => {
    await expect(burnPasswordCheck("whatever")).resolves.toBeUndefined();
  });

  it("enforces a minimum length for new passwords", () => {
    expect(validateNewPassword("short")).toMatch(/at least 12/);
    expect(validateNewPassword("long-enough-password")).toBeNull();
  });
});

describe("session tokens", () => {
  it("are random, URL-safe and 256-bit", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("are stored only as a deterministic SHA-256 hash", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

describe("normalizeIp", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["203.0.113.7, 10.0.0.1", "203.0.113.7"],
    [" 2001:db8::1 ", "2001:db8::1"],
    ["not-an-ip", null],
    ["", null],
    [null, null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });
});
