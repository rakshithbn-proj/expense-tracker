import type { NextConfig } from "next";

// Cache Components is deliberately off: every page of this private app reads the
// session per request, so nothing would be prerendered anyway (ADR-0001).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // The dev server is always force-killed (`app:stop` uses taskkill /F, and so does closing the
    // PC), which can leave Turbopack's on-disk dev cache half-written. A damaged cache made every
    // page load get "HMR hash mismatch" and reload forever. Cold compiles are fine for one user.
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
