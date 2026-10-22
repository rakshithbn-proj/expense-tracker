import { expect, test } from "@playwright/test";

const EMAIL = "e2e@example.com";
const PASSWORD = "e2e-password-123456";

test.describe("unauthenticated access", () => {
  for (const path of ["/", "/transactions", "/reports", "/automation", "/notifications"]) {
    test(`${path} redirects to login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
    });
  }

  test("API routes return 401 without a session", async ({ request }) => {
    const res = await request.get("/api/transactions", { maxRedirects: 0 });
    expect(res.status()).toBe(401);
  });

  test("a forged session cookie is rejected by the server-side check", async ({ page, context, baseURL }) => {
    await context.addCookies([
      { name: "__Host-et_session", value: "forged-token", domain: new URL(baseURL!).hostname, path: "/", secure: true, httpOnly: true },
    ]);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("health check reveals only status", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

test.describe("sign in", () => {
  test("wrong password shows a generic error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Incorrect email or password.");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("full session: sign in, navigate, sign out", async ({ page, context }, testInfo) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Not built yet · Milestone 3")).toBeVisible();

    const cookie = (await context.cookies()).find((c) => c.name === "__Host-et_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");

    const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
    await expect(nav).toHaveCount(1);
    if (testInfo.project.name === "mobile") {
      const box = await nav.boundingBox();
      expect(box!.y).toBeGreaterThan(700); // bottom tab bar
    }
    await nav.getByRole("link", { name: "Transactions" }).click();
    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Transactions" })).toHaveAttribute("aria-current", "page");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("PWA", () => {
  test("manifest and icons are served", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.display).toBe("standalone");
    for (const icon of manifest.icons) {
      const res = await request.get(icon.src);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/png");
    }
    const apple = await request.get("/apple-icon");
    expect(apple.status()).toBe(200);
  });

  test("offline page never claims anything was saved", async ({ request }) => {
    const html = await (await request.get("/offline.html")).text();
    expect(html).toContain("Nothing can be viewed or saved while offline");
  });
});
