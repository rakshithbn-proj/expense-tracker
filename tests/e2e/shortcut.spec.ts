import { expect, request as playwrightRequest, test } from "@playwright/test";
import { signIn } from "./helpers";

test("an iPhone Shortcut key works end to end, and stops working when revoked", async ({ page, baseURL }, testInfo) => {
  await signIn(page);
  await page.goto("/settings");
  const name = `Phone ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel("New key name").fill(name);
  await page.getByRole("button", { name: "Create key" }).click();
  const key = await page.getByTestId("device-key-value").inputValue();
  const endpoint = await page.getByTestId("device-key-endpoint").inputValue();
  expect(key).toMatch(/^etk_/);
  expect(endpoint).toBe(`${baseURL}/api/ingest/shortcut`);

  // A fresh client with no cookies, like the Shortcuts app.
  const phone = await playwrightRequest.newContext({ baseURL });
  const merchant = `Shortcut Cafe ${testInfo.project.name} ${Date.now()}`;
  const send = (auth: string, data: unknown) => phone.post("/api/ingest/shortcut", { headers: { Authorization: auth }, data });

  const ok = await send(`Bearer ${key}`, { kind: "quick_add", amount: "123.45", merchant, paymentApp: "Google Pay" });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ status: "captured", message: "Saved." });

  const asText = await phone.post("/api/ingest/shortcut?format=text", {
    headers: { Authorization: `Bearer ${key}` },
    data: { kind: "quick_add", amount: "1", merchant: `Plain reply ${Date.now()}` },
  });
  expect(asText.headers()["content-type"]).toContain("text/plain");
  expect(await asText.text()).toBe("Saved.");

  expect((await send("Bearer etk_not-a-real-key", { kind: "quick_add", amount: 1 })).status()).toBe(401);
  expect((await send(`Bearer ${key}`, { kind: "quick_add", amount: "abc" })).status()).toBe(400);
  const notJson = await phone.post("/api/ingest/shortcut", { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, data: "{oops" });
  expect(notJson.status()).toBe(400);

  // It shows up in the app as a manual entry with the stated app.
  await page.goto(`/transactions?q=${encodeURIComponent(merchant)}`);
  await page.getByTestId("transaction-row").first().click();
  await expect(page.getByTestId("detail-amount")).toHaveText("−₹123.45");
  await expect(page.getByText("Google Pay")).toBeVisible();
  await expect(page.getByText("Entered manually")).toBeVisible();

  // Revoking the key stops it immediately.
  await page.goto("/settings");
  const row = page.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row.getByText("Revoked")).toBeVisible();
  expect((await send(`Bearer ${key}`, { kind: "quick_add", amount: 1 })).status()).toBe(401);
  await phone.dispose();
});
