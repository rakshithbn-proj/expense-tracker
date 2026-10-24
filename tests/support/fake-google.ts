import type { GmailMessage } from "@/server/ingestion/email/gmail-message";

// An in-memory stand-in for Google's OAuth and Gmail REST endpoints. No network is used.
export class FakeGoogle {
  messages = new Map<string, GmailMessage>();
  queries: string[] = [];
  revoked: string[] = [];
  refreshCalls = 0;
  failNextGets = 0; // respond 500 to the next N message fetches
  failStatus = 500;
  refreshRejected = false;

  add(message: GmailMessage) {
    this.messages.set(message.id, message);
  }

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

    if (u.host === "oauth2.googleapis.com" && u.pathname === "/token") {
      this.refreshCalls++;
      if (this.refreshRejected) return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
      return json({ access_token: `access-${this.refreshCalls}`, expires_in: 3600 });
    }
    if (u.host === "oauth2.googleapis.com" && u.pathname === "/revoke") {
      this.revoked.push(u.searchParams.get("token") ?? "");
      return json({});
    }
    if (u.host !== "gmail.googleapis.com") return json({ error: "unexpected host" }, 500);
    if (!new Headers(init?.headers).get("Authorization")?.startsWith("Bearer access-")) return json({ error: { status: "UNAUTHENTICATED" } }, 401);

    const path = u.pathname.replace("/gmail/v1/users/me", "");
    if (path === "/profile") return json({ emailAddress: "owner@gmail.example", historyId: "1" });
    if (path === "/messages") {
      const q = u.searchParams.get("q") ?? "";
      this.queries.push(q);
      const after = Number(/after:(\d+)/.exec(q)?.[1] ?? 0) * 1000;
      const ids = [...this.messages.values()].filter((m) => Number(m.internalDate) >= after).map((m) => ({ id: m.id }));
      return json({ messages: ids });
    }
    const m = /^\/messages\/(.+)$/.exec(path);
    if (m) {
      if (this.failNextGets > 0) {
        this.failNextGets--;
        return json({ error: { status: "INTERNAL" } }, this.failStatus);
      }
      const message = this.messages.get(decodeURIComponent(m[1]));
      return message ? json(message) : json({ error: { status: "NOT_FOUND" } }, 404);
    }
    return json({ error: "not found" }, 404);
  };
}
