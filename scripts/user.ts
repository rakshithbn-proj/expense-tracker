// Usage:
//   npm run user:create -- you@example.com
//   npm run user:reset-password -- you@example.com
// The password is prompted for (hidden). Set ET_PASSWORD only for automated setups such as E2E tests.
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function readPassword(): Promise<string> {
  if (process.env.ET_PASSWORD) return process.env.ET_PASSWORD;
  const first = await promptHidden("New password: ");
  const second = await promptHidden("Repeat password: ");
  if (first !== second) throw new Error("Passwords do not match.");
  return first;
}

async function main() {
  const [command, email] = process.argv.slice(2);
  if (!email || (command !== "create" && command !== "reset-password")) {
    throw new Error("Usage: user.ts <create|reset-password> <email>");
  }

  const { db, closeDb } = await import("../src/server/db/client");
  const { createOwner, resetPassword } = await import("../src/server/users");
  try {
    const password = await readPassword();
    const user =
      command === "create"
        ? await createOwner(db(), email, password)
        : await resetPassword(db(), email, password);
    console.log(command === "create" ? `Created ${user.email}` : `Password reset for ${user.email}; all sessions signed out.`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
