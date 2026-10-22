import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  // Chromium for both viewports: WebKit refuses Secure cookies on http://localhost, so
  // real iPhone Safari is verified manually over HTTPS at deployment (Milestone 9).
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 393, height: 852 } } },
  ],
  webServer: {
    command: "npx tsx --conditions=react-server scripts/e2e-server.ts",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { E2E_PORT: String(PORT) },
  },
});
