import "server-only";
import { hash, verify } from "@node-rs/argon2";

// OWASP minimum argon2id parameters (19 MiB, 2 passes, 1 lane). The algorithm defaults to argon2id.
const options = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Used when the email is unknown, so a failed login takes the same time either way.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
}
