import { describe, expect, it } from "vitest";
import { buildGoogleAuthUrl, verifiedEmailFromIdToken } from "@/server/google/oauth";
import { SHEETS_CONSENT_SCOPES } from "@/server/sheets/client";

const oauth = { clientId: "id", clientSecret: "secret", redirectUri: "http://localhost:3000/api/sheets/callback" };
const idToken = (claims: object) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

describe("Sheets consent URL", () => {
  it("pre-selects the chosen account and asks for its email plus drive.file only", () => {
    const url = new URL(buildGoogleAuthUrl(oauth, SHEETS_CONSENT_SCOPES, "s", { loginHint: "owner@gmail.example", chooseAccount: true }));
    expect(url.searchParams.get("login_hint")).toBe("owner@gmail.example");
    expect(url.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/drive.file");
  });

  it("forces Google's account chooser, so an existing session isn't reused silently", () => {
    const url = new URL(buildGoogleAuthUrl(oauth, SHEETS_CONSENT_SCOPES, "s", { chooseAccount: true }));
    expect(url.searchParams.get("prompt")).toBe("select_account consent");
  });

  it("leaves out the hint and the chooser when not asked for (the Gmail flow)", () => {
    const url = new URL(buildGoogleAuthUrl(oauth, SHEETS_CONSENT_SCOPES, "s"));
    expect(url.searchParams.has("login_hint")).toBe(false);
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
});

describe("account email from the ID token", () => {
  it("reads a verified address, lower-cased", () => {
    expect(verifiedEmailFromIdToken(idToken({ email: "Owner@Gmail.Example", email_verified: true }))).toBe("owner@gmail.example");
  });

  it.each([
    ["an unverified address", idToken({ email: "a@b.example", email_verified: false })],
    ["no email claim", idToken({ sub: "1" })],
    ["a malformed token", "not-a-jwt"],
    ["no token", undefined],
  ])("returns null for %s", (_label, token) => {
    expect(verifiedEmailFromIdToken(token)).toBeNull();
  });
});
