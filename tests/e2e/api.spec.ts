import { expect, test, type Page } from "@playwright/test";

const EMAIL = "e2e@example.com";
const PASSWORD = "e2e-password-123456";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe("transactions API (signed in)", () => {
  test("create, list, correct, summarize and void a manual transaction", async ({ page, baseURL }, testInfo) => {
    await signIn(page);
    const api = page.request;
    const headers = { Origin: baseURL! };
    const merchant = `E2E Cafe ${testInfo.project.name}`;

    const categories = (await (await api.get("/api/categories")).json()).items as { id: string; systemKey: string }[];
    const food = categories.find((c) => c.systemKey === "food_dining")!;

    const created = await api.post("/api/transactions", {
      headers,
      data: { transactionDate: "2026-10-05", amountPaise: 45000, direction: "debit", transactionType: "purchase", merchantName: merchant },
    });
    expect(created.status()).toBe(201);
    const { transaction } = await created.json();
    expect(transaction).toMatchObject({ captureMethod: "manual", needsReview: true, amountPaise: 45000 });

    const list = await (await api.get(`/api/transactions?q=${encodeURIComponent(merchant)}`)).json();
    expect(list.items.map((t: { id: string }) => t.id)).toEqual([transaction.id]);

    const corrected = await api.patch(`/api/transactions/${transaction.id}`, {
      headers,
      data: { categoryId: food.id, markReviewed: true },
    });
    expect(corrected.status()).toBe(200);
    expect((await corrected.json()).transaction).toMatchObject({ categoryId: food.id, needsReview: false, merchantName: merchant });

    const summary = await (await api.get("/api/summary?month=2026-10")).json();
    expect(summary.byCategory[food.id]).toBeGreaterThanOrEqual(45000);

    const voided = await api.delete(`/api/transactions/${transaction.id}?reason=test`, { headers });
    expect(voided.status()).toBe(200);
    const after = await (await api.get(`/api/transactions?q=${encodeURIComponent(merchant)}`)).json();
    expect(after.total).toBe(0);
  });

  test("rejects writes from another site", async ({ page }) => {
    await signIn(page);
    const res = await page.request.post("/api/transactions", {
      headers: { Origin: "https://evil.example" },
      data: { transactionDate: "2026-10-05", amountPaise: 100, direction: "debit", transactionType: "purchase" },
    });
    expect(res.status()).toBe(403);
    const noOrigin = await page.request.post("/api/transactions", {
      data: { transactionDate: "2026-10-05", amountPaise: 100, direction: "debit", transactionType: "purchase" },
    });
    expect(noOrigin.status()).toBe(403);
  });

  test("returns clear errors without internal details", async ({ page, baseURL }) => {
    await signIn(page);
    const headers = { Origin: baseURL! };
    const bad = await page.request.post("/api/transactions", { headers, data: { amountPaise: -5 } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toBe("invalid_request");

    const wrongDirection = await page.request.post("/api/transactions", {
      headers,
      data: { transactionDate: "2026-10-05", amountPaise: 100, direction: "debit", transactionType: "refund" },
    });
    expect(wrongDirection.status()).toBe(409);

    expect((await page.request.get("/api/transactions/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
    expect((await page.request.get("/api/transactions/not-a-uuid")).status()).toBe(400);
  });
});
