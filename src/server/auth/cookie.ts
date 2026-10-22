// Shared by proxy.ts and the session helpers, so it has no server-only import.
// `__Host-` requires the Secure flag, which only works over HTTPS, so dev uses a plain name.
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-et_session" : "et_session";
