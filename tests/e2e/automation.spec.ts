import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("automation page reports capture status honestly when Gmail isn't configured", async ({ page }) => {
  await signIn(page);
  await page.goto("/automation");
  await expect(page.getByRole("heading", { name: "Automation" })).toBeVisible();
  await expect(page.getByText(/Not configured\. The server needs a Google OAuth client/)).toBeVisible();

  const capabilities = page.getByTestId("capability");
  await expect(capabilities.filter({ hasText: "Reading PhonePe / Google Pay notifications" })).toContainText("Unsupported by the current platform");
  for (const bank of ["HDFC Bank", "HSBC", "ICICI Bank", "RBL Bank"]) {
    const row = capabilities.filter({ hasText: `${bank} alerts via Gmail` });
    await expect(row).toContainText("Not configured");
    await expect(row).not.toContainText("Tested successfully");
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("starting the Gmail connection without configuration explains why", async ({ page, baseURL }) => {
  await signIn(page);
  await page.goto("/api/gmail/connect");
  await expect(page).toHaveURL(`${baseURL}/automation?gmail=not_configured`);
  await expect(page.getByRole("status").filter({ hasText: "Gmail isn't configured" })).toBeVisible();
});

test("the Gmail callback requires a signed-in session", async ({ request }) => {
  const res = await request.get("/api/gmail/callback?code=x&state=y", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
});
