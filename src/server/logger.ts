import "server-only";
import pino from "pino";

// Paths that must never reach logs. Extend this list as integrations are added.
const redact = [
  "password",
  "*.password",
  "token",
  "*.token",
  "accessToken",
  "refreshToken",
  "*.refreshToken",
  "cookie",
  "headers.cookie",
  "headers.authorization",
  "req.headers.cookie",
  "req.headers.authorization",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: redact, censor: "[redacted]" },
  base: undefined,
});
