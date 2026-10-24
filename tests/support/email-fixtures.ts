import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { GmailMessage } from "@/server/ingestion/email/gmail-message";

export type EmailFixture = {
  file: string;
  source: string;
  from: string;
  subject: string;
  date: string;
  html: string | null;
  text: string | null;
  expected?: Record<string, unknown>;
};

const ROOT = path.resolve("tests/fixtures/email");

export function loadEmailFixtures(): EmailFixture[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(path.join(ROOT, d.name))
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ file: `${d.name}/${f}`, ...JSON.parse(readFileSync(path.join(ROOT, d.name, f), "utf8")) })),
    );
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

// Shapes a fixture like a Gmail API `messages.get` response, so tests exercise the real decoding.
// The shape Gmail records for these banks (observed on the real samples): DKIM signed by the
// sender's own domain. Tests can pass different results to simulate spoofing or forwarding.
export function gmailAuthResult(fromHeader: string): string {
  const domain = /@([^>\s]+)/.exec(fromHeader)?.[1]?.toLowerCase() ?? "";
  return `mx.google.com; dkim=pass header.i=@${domain} header.s=s1 header.b=abc; spf=pass smtp.mailfrom=${domain}; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${domain}`;
}

export function toGmailMessage(f: EmailFixture, id = `fixture-${f.file}`, authResults: string[] = [gmailAuthResult(f.from)]): GmailMessage {
  const body = f.html
    ? { mimeType: "text/html", body: { data: b64url(f.html) } }
    : { mimeType: "text/plain", body: { data: b64url(f.text ?? "") } };
  return {
    id,
    internalDate: String(Date.parse(f.date)),
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: f.from },
        { name: "Subject", value: f.subject },
        ...authResults.map((value) => ({ name: "Authentication-Results", value })),
        { name: "Date", value: new Date(f.date).toUTCString() },
      ],
      parts: [body],
    },
  };
}
