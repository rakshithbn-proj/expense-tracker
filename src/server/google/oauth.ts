// Google OAuth 2.0 pieces shared by the Gmail and Sheets integrations.
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// The refresh token was revoked or expired, or access was refused: the user must reconnect.
export class GoogleAuthError extends Error {}
// Rate limits, server errors and network failures: retry later.
export class GoogleTransientError extends Error {}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type OAuthClient = { clientId: string; clientSecret: string; redirectUri: string };

// `loginHint` suggests a Google account, but Google treats it as a hint only: with a single
// signed-in session it may go straight on with that account. `chooseAccount` makes Google always
// show its account chooser. Either way the callback must check which account approved.
export function buildGoogleAuthUrl(
  oauth: OAuthClient,
  scope: string,
  state: string,
  options: { loginHint?: string; chooseAccount?: boolean } = {},
): string {
  const params = new URLSearchParams({
    ...(options.loginHint ? { login_hint: options.loginHint } : {}),
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: "code",
    scope,
    access_type: "offline", // ask for a refresh token
    // "consent" always returns a refresh token, even on reconnect.
    prompt: options.chooseAccount ? "select_account consent" : "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function readGoogleError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string | { message?: string; status?: string }; error_description?: string };
    if (typeof body.error === "string") return body.error_description ? `${body.error}: ${body.error_description}` : body.error;
    return body.error?.status ?? body.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function exchangeGoogleCode(oauth: OAuthClient, code: string, fetchImpl: FetchLike = fetch) {
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
  if (!res.ok) throw new GoogleAuthError(`Code exchange failed: ${await readGoogleError(res)}`);
  return (await res.json()) as { access_token: string; refresh_token?: string; scope: string; expires_in: number; id_token?: string };
}

// The verified email address in an ID token from the code exchange (requested with the
// "openid email" scopes). The token came straight from Google's token endpoint over TLS, so its
// signature doesn't need checking (Google's OpenID Connect guide says the same).
export function verifiedEmailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown; email_verified?: unknown };
    return typeof claims.email === "string" && claims.email_verified === true ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function revokeGoogleToken(token: string, fetchImpl: FetchLike = fetch): Promise<void> {
  // Best effort: an already-revoked token returns 400, which is fine.
  await fetchImpl(`${REVOKE_URL}?${new URLSearchParams({ token })}`, { method: "POST" }).catch(() => undefined);
}

// Exchanges a stored refresh token for short-lived access tokens, cached until near expiry.
export class AccessTokenSource {
  private cached: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly oauth: OAuthClient,
    private readonly refreshToken: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  invalidate() {
    this.cached = null;
  }

  async get(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.value;
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
      throw new GoogleTransientError(`Token refresh network error: ${err instanceof Error ? err.message : err}`);
    }
    if (res.status === 400 || res.status === 401) throw new GoogleAuthError(`Token refresh rejected: ${await readGoogleError(res)}`);
    if (!res.ok) throw new GoogleTransientError(`Token refresh failed: ${await readGoogleError(res)}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}
