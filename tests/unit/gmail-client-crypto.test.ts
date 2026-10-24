import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { buildAuthUrl, GmailAuthError, GmailClient, GmailTransientError, GMAIL_SCOPE, type FetchLike } from "@/server/ingestion/gmail/client";

describe("secret encryption", () => {
  const key = randomBytes(32);

  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("refresh-token", key);
    const b = encryptSecret("refresh-token", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("refresh-token");
  });

  it("detects tampering and the wrong key", () => {
    const enc = encryptSecret("refresh-token", key);
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
    expect(() => encryptSecret("x", randomBytes(16))).toThrow();
  });
});

const oauth = { clientId: "id", clientSecret: "secret", redirectUri: "http://localhost:3000/api/gmail/callback" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function scripted(responses: Response[]): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(new URL(url).pathname);
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next;
    },
  };
}

describe("Gmail client", () => {
  it("asks only for read-only Gmail access, offline, with a state value", () => {
    const url = new URL(buildAuthUrl(oauth, "abc"));
    expect(url.searchParams.get("scope")).toBe(GMAIL_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("redirect_uri")).toBe(oauth.redirectUri);
  });

  it("refreshes once on a 401 and retries the request", async () => {
    const s = scripted([
      json({ access_token: "a1", expires_in: 3600 }),
      json({ error: { status: "UNAUTHENTICATED" } }, 401),
      json({ access_token: "a2", expires_in: 3600 }),
      json({ emailAddress: "x@example.com", historyId: "1" }),
    ]);
    const client = new GmailClient(oauth, "refresh", s.fetch);
    expect((await client.getProfile()).emailAddress).toBe("x@example.com");
    expect(s.calls).toEqual(["/token", "/gmail/v1/users/me/profile", "/token", "/gmail/v1/users/me/profile"]);
  });

  it("classifies a revoked grant as an authorization problem", async () => {
    const client = new GmailClient(oauth, "refresh", scripted([json({ error: "invalid_grant" }, 400)]).fetch);
    await expect(client.getProfile()).rejects.toBeInstanceOf(GmailAuthError);
  });

  it("classifies rate limits, server errors and network failures as temporary", async () => {
    for (const failure of [json({ error: { status: "RESOURCE_EXHAUSTED" } }, 429), json({}, 503)]) {
      const client = new GmailClient(oauth, "refresh", scripted([json({ access_token: "a", expires_in: 3600 }), failure]).fetch);
      await expect(client.listMessages("q")).rejects.toBeInstanceOf(GmailTransientError);
    }
    const offline = new GmailClient(oauth, "refresh", async () => {
      throw new Error("ECONNRESET");
    });
    await expect(offline.getProfile()).rejects.toBeInstanceOf(GmailTransientError);
  });

  it("reuses an access token until it nears expiry", async () => {
    const s = scripted([json({ access_token: "a", expires_in: 3600 }), json({ messages: [] }), json({ messages: [] })]);
    const client = new GmailClient(oauth, "refresh", s.fetch);
    await client.listMessages("q");
    await client.listMessages("q");
    expect(s.calls.filter((c) => c === "/token")).toHaveLength(1);
  });
});
