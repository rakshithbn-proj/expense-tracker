// Turns a real alert email (.eml, kept only in the git-ignored .data folder) into a redacted
// test fixture. Every URL and HTML comment is removed, the listed values are replaced, and the
// result is checked so none of the original values survive.
//
//   node scripts/make-email-fixture.mjs <in.eml> <out.json> "real=>fake" ["real=>fake" ...]
//
// Always read the output before committing it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import PostalMime from "postal-mime";

const [input, output, ...pairs] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/make-email-fixture.mjs <in.eml> <out.json> "real=>fake" ...');
  process.exit(1);
}
const replacements = pairs.map((p) => {
  const [from, to] = p.split("=>");
  if (!from || to === undefined) throw new Error(`Bad replacement: ${p}`);
  return [from, to];
});

const mail = await PostalMime.parse(readFileSync(input));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const redact = (text) => {
  let out = text
    .replace(/<!--[\s\S]*?-->/g, "")
    // Links and images can carry per-recipient tracking tokens.
    .replace(/\b(href|src|background|action)\s*=\s*(["'])[\s\S]*?\2/gi, '$1=$2https://example.invalid/$2')
    .replace(/url\(\s*(['"]?)[^)'"]*\1\s*\)/gi, "url(https://example.invalid/)");
  for (const [from, to] of replacements) out = out.replace(new RegExp(escape(from), "gi"), to);
  return out;
};

const fixture = {
  // The original file name, which only says what kind of alert this is.
  source: path.basename(input),
  from: mail.from?.name ? `${mail.from.name} <${mail.from.address}>` : mail.from?.address,
  subject: redact(mail.subject ?? ""),
  date: new Date(mail.date).toISOString(),
  html: mail.html ? redact(mail.html) : null,
  text: mail.html ? null : redact(mail.text ?? ""),
};
if (existsSync(output)) {
  const previous = JSON.parse(readFileSync(output, "utf8"));
  if (previous.expected) fixture.expected = previous.expected;
}

const serialized = JSON.stringify(fixture);
const leaks = replacements.filter(([from]) => serialized.toLowerCase().includes(from.toLowerCase())).map(([from]) => from);
const urls = [...serialized.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)].map((m) => m[0]).filter((u) => !u.startsWith("https://example.invalid/"));
const emails = [...new Set(serialized.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [])];

if (leaks.length) {
  console.error("Refusing to write: original values still present:", leaks);
  process.exit(1);
}
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(fixture, null, 2) + "\n");
console.log(`Wrote ${output}`);
console.log(`  remaining visible URLs: ${urls.length ? urls.join(" ") : "none"}`);
console.log(`  email addresses: ${emails.join(", ") || "none"}`);
