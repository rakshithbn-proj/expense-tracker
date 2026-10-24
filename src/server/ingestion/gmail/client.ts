// Minimal client for the official Gmail REST API and Google OAuth 2.0 endpoints.
// Only the read-only Gmail scope is ever requested.
import type { GmailMessage } from "../email/gmail-message";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

// The refresh token was revoked or expired: the user must reconnect.
export class GmailAuthError extends Error {}
// Rate limits, server errors and network failures: retry later.
export class GmailTransientError extends Error {}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type OAuthClient = { clientId: string; clientSecret: string; redirectUri: string };

export function buildAuthUrl(oauth: OAuthClient, state: string): string {
  const params = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // always return a refresh token, even on reconnect
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string | { message?: string; status?: string }; error_description?: string };
    if (typeof body.error === "string") return body.error_description ? `${body.error}: ${body.error_description}` : body.error;
    return body.error?.status ?? body.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export class GmailClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly oauth: OAuthClient,
    private readonly refreshToken: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  static async exchangeCode(oauth: OAuthClient, code: string, fetchImpl: FetchLike = fetch) {
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        redirect_uri: oauth.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) throw new GmailAuthError(`Code exchange failed: ${await readError(res)}`);
    return (await res.json()) as { access_token: string; refresh_token?: string; scope: string; expires_in: number };
  }

  static async revoke(token: string, fetchImpl: FetchLike = fetch): Promise<void> {
    // Best effort: an already-revoked token returns 400, which is fine.
    await fetchImpl(`${REVOKE_URL}?${new URLSearchParams({ token })}`, { method: "POST" }).catch(() => undefined);
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    let res: Response;
    try {
      res = await this.fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.oauth.clientId,
          client_secret: this.oauth.clientSecret,
          refresh_token: this.refreshToken,
          grant_type: "refresh_token",
        }),
      });
    } catch (err) {
      throw new GmailTransientError(`Token refresh network error: ${err instanceof Error ? err.message : err}`);
    }
    if (res.status === 400 || res.status === 401) throw new GmailAuthError(`Token refresh rejected: ${await readError(res)}`);
    if (!res.ok) throw new GmailTransientError(`Token refresh failed: ${await readError(res)}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async get<T>(path: string, params: Record<string, string | string[] | undefined> = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) qs.append(k, item);
    }
    const url = `${API}${path}${qs.size ? `?${qs}` : ""}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${await this.token()}` } });
      } catch (err) {
        if (err instanceof GmailAuthError || err instanceof GmailTransientError) throw err;
        throw new GmailTransientError(`Network error: ${err instanceof Error ? err.message : err}`);
      }
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401 && attempt === 0) {
        this.accessToken = null; // expired early: refresh once and retry
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new GmailAuthError(`Gmail API refused access: ${await readError(res)}`);
      if (res.status === 429 || res.status >= 500) throw new GmailTransientError(`Gmail API ${res.status}: ${await readError(res)}`);
      throw new Error(`Gmail API ${res.status}: ${await readError(res)}`);
    }
    throw new GmailAuthError("Gmail API refused access after refreshing the token");
  }

  getProfile() {
    return this.get<{ emailAddress: string; historyId: string }>("/profile");
  }

  listMessages(q: string, pageToken?: string) {
    return this.get<{ messages?: { id: string }[]; nextPageToken?: string }>("/messages", { q, pageToken, maxResults: "100" });
  }

  getMessage(id: string, format: "full" | "metadata" = "full") {
    return this.get<GmailMessage>(`/messages/${encodeURIComponent(id)}`, {
      format,
      metadataHeaders: format === "metadata" ? ["From", "Subject", "Date"] : undefined,
    });
  }
}
