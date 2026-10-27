import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { signIn } from "./helpers";

test("the iPhone explain Shortcut can fetch waiting payments and answer them with a device key", async ({ page, baseURL }, testInfo) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByLabel("New key name").fill(`Explain ${testInfo.project.name} ${Date.now()}`);
  await page.getByRole("button", { name: "Create key" }).click();
  const key = await page.getByTestId("device-key-value").inputValue();
  const phone = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${key}` } });

  const merchant = `EXPLAIN CAFE ${randomUUID().slice(0, 8)}`;
  expect((await phone.post("/api/ingest/shortcut", { data: { kind: "quick_add", amount: "250", merchant } })).status()).toBe(200);

  // Run by hand (manual=1): asks now, regardless of the schedule.
  const res = await phone.get("/api/ingest/explain?manual=1");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { count: number; title: string; items: { id: string; label: string; categories: string[] }[] };
  const item = body.items.find((i) => i.label.includes(merchant));
  expect(item, JSON.stringify(body)).toBeDefined();
  expect(item!.label).toMatch(/^₹250\.00 · /);
  expect(item!.categories).toContain("Shopping");

  const answer = await phone.post("/api/ingest/explain?format=text", { data: { id: item!.id, category: "Shopping", reason: "Birthday gift", remember: "no" } });
  expect(await answer.text()).toBe("Saved: Shopping · Birthday gift");

  // Answered: no longer offered, and can't be answered again through the key.
  const after = (await (await phone.get("/api/ingest/explain?manual=1")).json()) as { items: { id: string }[] };
  expect(after.items.some((i) => i.id === item!.id)).toBe(false);
  expect((await phone.post("/api/ingest/explain", { data: { id: item!.id, category: "Shopping" } })).status()).toBe(404);
  expect((await phone.post("/api/ingest/explain", { data: { id: randomUUID(), category: "Shopping" } })).status()).toBe(404);

  // The answer shows on the transaction.
  await page.goto(`/transactions?q=${encodeURIComponent(merchant)}`);
  await page.getByTestId("transaction-row").first().click();
  await expect(page.getByText("Birthday gift").first()).toBeVisible();

  const stranger = await playwrightRequest.newContext({ baseURL });
  expect((await stranger.get("/api/ingest/explain")).status()).toBe(401);
  await Promise.all([phone.dispose(), stranger.dispose()]);
});

test("payments can be explained on the To explain page", async ({ page, baseURL }) => {
  await signIn(page);
  await page.goto("/explain"); // first visit starts asking from now
  const merchant = `PAGE CAFE ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/transactions", {
    headers: { Origin: baseURL! },
    data: { transactionDate: "2026-10-27", amountPaise: 9900, direction: "debit", transactionType: "purchase", merchantName: merchant },
  });
  expect(created.status()).toBe(201);

  await page.goto("/explain");
  const item = page.getByTestId("explain-item").filter({ hasText: merchant });
  await item.getByRole("combobox").selectOption("Food & Dining");
  await item.getByLabel("Why was this? (optional)").fill("Team lunch");
  await item.getByRole("button", { name: "Save" }).click();
  // Answered payments leave the list straight away, and stay gone.
  await expect(page.getByTestId("explain-item").filter({ hasText: merchant })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("explain-item").filter({ hasText: merchant })).toHaveCount(0);
  await page.goto(`/transactions?q=${encodeURIComponent(merchant)}`);
  await page.getByTestId("transaction-row").first().click();
  await expect(page.getByText("Team lunch").first()).toBeVisible();
  await page.goto("/explain");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});
