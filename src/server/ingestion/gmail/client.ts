// Minimal client for the official Gmail REST API. Only the read-only Gmail scope is ever requested.
import {
  AccessTokenSource,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  GoogleAuthError,
  GoogleTransientError,
  readGoogleError,
  revokeGoogleToken,
  type FetchLike,
  type OAuthClient,
} from "@/server/google/oauth";
import type { GmailMessage } from "../email/gmail-message";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

// The same classes as the shared Google ones, under the names the Gmail code uses.
export { GoogleAuthError as GmailAuthError, GoogleTransientError as GmailTransientError };
export type { FetchLike, OAuthClient };

export function buildAuthUrl(oauth: OAuthClient, state: string): string {
  return buildGoogleAuthUrl(oauth, GMAIL_SCOPE, state);
}

export class GmailClient {
  private readonly tokens: AccessTokenSource;

  constructor(
    oauth: OAuthClient,
    refreshToken: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.tokens = new AccessTokenSource(oauth, refreshToken, fetchImpl);
  }

  static exchangeCode(oauth: OAuthClient, code: string, fetchImpl: FetchLike = fetch) {
    return exchangeGoogleCode(oauth, code, fetchImpl);
  }

  static revoke(token: string, fetchImpl: FetchLike = fetch): Promise<void> {
    return revokeGoogleToken(token, fetchImpl);
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
        res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${await this.tokens.get()}` } });
      } catch (err) {
        if (err instanceof GoogleAuthError || err instanceof GoogleTransientError) throw err;
        throw new GoogleTransientError(`Network error: ${err instanceof Error ? err.message : err}`);
      }
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401 && attempt === 0) {
        this.tokens.invalidate(); // expired early: refresh once and retry
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new GoogleAuthError(`Gmail API refused access: ${await readGoogleError(res)}`);
      if (res.status === 429 || res.status >= 500) throw new GoogleTransientError(`Gmail API ${res.status}: ${await readGoogleError(res)}`);
      throw new Error(`Gmail API ${res.status}: ${await readGoogleError(res)}`);
    }
    throw new GoogleAuthError("Gmail API refused access after refreshing the token");
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
