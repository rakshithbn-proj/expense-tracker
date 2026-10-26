// Minimal client for the Google Sheets REST API (v4). The only scope requested is drive.file,
// which reaches nothing in the user's Drive except spreadsheets this app created.
import { AccessTokenSource, GoogleAuthError, GoogleTransientError, type FetchLike, type OAuthClient } from "@/server/google/oauth";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/drive.file";
// What the consent screen asks for: the spreadsheet access, plus the account's email address so
// the app can confirm the spreadsheet goes to the account the user chose.
export const SHEETS_CONSENT_SCOPES = `openid email ${SHEETS_SCOPE}`;
const API = "https://sheets.googleapis.com/v4/spreadsheets";

// The spreadsheet no longer exists (deleted, or owned by a different Google account).
export class SpreadsheetNotFoundError extends Error {}

export type SheetValue = string | number;
export type SheetProperties = { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } };
export type Spreadsheet = { spreadsheetId: string; spreadsheetUrl: string; sheets?: { properties: SheetProperties }[] };

// Google's message is more useful than its status here (e.g. "Google Sheets API has not been
// used in project ... or it is disabled"), so prefer it.
async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string | { message?: string; status?: string }; error_description?: string };
    if (typeof body.error === "string") return body.error_description ?? body.error;
    return (body.error?.message ?? body.error?.status ?? `HTTP ${res.status}`).slice(0, 300);
  } catch {
    return `HTTP ${res.status}`;
  }
}

export class SheetsClient {
  private readonly tokens: AccessTokenSource;

  constructor(
    oauth: OAuthClient,
    refreshToken: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.tokens = new AccessTokenSource(oauth, refreshToken, fetchImpl);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${API}${path}`, {
          method,
          headers: { Authorization: `Bearer ${await this.tokens.get()}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        if (err instanceof GoogleAuthError || err instanceof GoogleTransientError) throw err;
        throw new GoogleTransientError(`Network error: ${err instanceof Error ? err.message : err}`);
      }
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401 && attempt === 0) {
        this.tokens.invalidate(); // expired early: refresh once and retry
        continue;
      }
      if (res.status === 401) throw new GoogleAuthError(`Google Sheets refused access: ${await errorText(res)}`);
      if (res.status === 404) throw new SpreadsheetNotFoundError("The spreadsheet no longer exists");
      if (res.status === 429 || res.status >= 500) throw new GoogleTransientError(`Google Sheets ${res.status}: ${await errorText(res)}`);
      // 403 is usually a setup problem (the Sheets API isn't enabled): retrying later helps once it's fixed.
      throw new Error(`Google Sheets ${res.status}: ${await errorText(res)}`);
    }
    throw new GoogleAuthError("Google Sheets refused access after refreshing the token");
  }

  create(title: string, sheetTitle: string) {
    return this.call<Spreadsheet>("POST", "", {
      // No locale: the API rejects "en_IN" ("Unsupported locale"), and the account's default is fine
      // because amounts are written as plain numbers.
      properties: { title, timeZone: "Asia/Kolkata" },
      sheets: [{ properties: { title: sheetTitle, gridProperties: { frozenRowCount: 1 } } }],
    });
  }

  get(spreadsheetId: string) {
    return this.call<Spreadsheet>("GET", `/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,sheets.properties`);
  }

  batchUpdate(spreadsheetId: string, requests: unknown[]) {
    return this.call<{ replies?: { addSheet?: { properties: SheetProperties } }[] }>("POST", `/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { requests });
  }

  // RAW input: values are stored exactly as given, so text is never parsed as a formula.
  updateValues(spreadsheetId: string, range: string, values: SheetValue[][]) {
    return this.call("PUT", `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      range,
      majorDimension: "ROWS",
      values,
    });
  }

  clearValues(spreadsheetId: string, range: string) {
    return this.call("POST", `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`, {});
  }
}
