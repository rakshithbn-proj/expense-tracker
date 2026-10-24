import { verifySender } from "./authentication";
import { htmlToText } from "./html-text";
import type { AlertEmail } from "./types";

// The subset of the Gmail API `users.messages.get` (format=full) response that we read.
export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};
export type GmailMessage = { id: string; threadId?: string; historyId?: string; internalDate?: string; payload?: GmailPart };

export function header(part: GmailPart | undefined, name: string): string | undefined {
  return part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

// "HDFC Bank InstaAlerts <alerts@hdfcbank.bank.in>" -> "alerts@hdfcbank.bank.in"
export function emailAddress(from: string | undefined): string {
  if (!from) return "";
  const angle = /<([^>]+)>/.exec(from);
  return (angle ? angle[1] : from).trim().toLowerCase();
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function collect(part: GmailPart | undefined, out: { html: string[]; text: string[] }) {
  if (!part) return;
  const type = part.mimeType?.toLowerCase() ?? "";
  if (part.body?.data && !part.body.attachmentId) {
    if (type === "text/html") out.html.push(decodeBase64Url(part.body.data));
    else if (type === "text/plain") out.text.push(decodeBase64Url(part.body.data));
  }
  for (const child of part.parts ?? []) collect(child, out);
}

export function toAlertEmail(message: GmailMessage): AlertEmail {
  const bodies = { html: [] as string[], text: [] as string[] };
  collect(message.payload, bodies);
  // Prefer HTML: several banks send only HTML, and their plain-text parts can be stale templates.
  const text = bodies.html.length ? bodies.html.map(htmlToText).join("\n") : bodies.text.join("\n");
  const dateHeader = header(message.payload, "Date");
  const received = message.internalDate ? new Date(Number(message.internalDate)) : dateHeader ? new Date(dateHeader) : new Date(NaN);
  const fromAddress = emailAddress(header(message.payload, "From"));
  // Header order is preserved by the Gmail API: the first one is the newest.
  const authResults = (message.payload?.headers ?? []).filter((h) => h.name.toLowerCase() === "authentication-results").map((h) => h.value);
  return {
    messageId: message.id,
    fromAddress,
    subject: header(message.payload, "Subject") ?? "",
    receivedAt: received,
    text,
    authentication: verifySender(fromAddress, authResults),
  };
}
