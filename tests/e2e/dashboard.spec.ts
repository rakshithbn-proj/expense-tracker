import { expect, test } from "@playwright/test";
import { api, signIn } from "./helpers";

// Each test uses its own past month per project so totals never mix between tests or viewports.
const MONTHS = { desktop: ["2026-06", "2026-07"], mobile: ["2026-04", "2026-05"] } as const;
type Tx = { transaction: { id: string } };
type Categories = { items: { id: string; systemKey: string }[] };

test("dashboard applies the accounting rules: refunds, card bills and transfers", async ({ page, baseURL }, testInfo) => {
  const month = MONTHS[testInfo.project.name as keyof typeof MONTHS][0];
  const tag = `${testInfo.project.name}-${Date.now()}`;
  await signIn(page);
  const client = api(page, baseURL!);
  const bank = await client.post<{ id: string }>("/api/accounts", { institutionName: "E2E Bank", accountName: `Savings ${tag}`, accountType: "bank_account" });
  const bank2 = await client.post<{ id: string }>("/api/accounts", { institutionName: "E2E Bank 2", accountName: `Savings ${tag}`, accountType: "bank_account" });
  const card = await client.post<{ id: string }>("/api/accounts", { institutionName: "E2E Card", accountName: `Card ${tag}`, accountType: "credit_card" });
  const food = (await client.get<Categories>("/api/categories")).items.find((c) => c.systemKey === "food_dining")!;

  const tx = (data: Record<string, unknown>) =>
    client.post<Tx>("/api/transactions", { transactionDate: `${month}-10`, direction: "debit", transactionType: "purchase", ...data });

  // ₹2,000 card purchase, then the card bill paid from the bank: counts once.
  await tx({ amountPaise: 2000_00, financialAccountId: card.id, merchantName: `Store ${tag}`, categoryId: food.id });
  await tx({ amountPaise: 2000_00, financialAccountId: bank.id, transactionType: "card_settlement" });
  await tx({ amountPaise: 2000_00, financialAccountId: card.id, transactionType: "card_settlement", direction: "credit" });
  // Own-account transfer: not spending.
  await tx({ amountPaise: 5000_00, financialAccountId: bank.id, transactionType: "internal_transfer" });
  await tx({ amountPaise: 5000_00, financialAccountId: bank2.id, transactionType: "internal_transfer", direction: "credit" });
  // ₹1,000 purchase with a ₹400 refund that links automatically.
  await tx({ amountPaise: 1000_00, financialAccountId: bank.id, merchantName: `Cafe ${tag}`, categoryId: food.id });
  await tx({ amountPaise: 400_00, financialAccountId: bank.id, merchantName: `Cafe ${tag}`, transactionType: "refund", direction: "credit", transactionDate: `${month}-12` });

  await page.goto(`/?month=${month}`);
  await expect(page.getByTestId("net-spending")).toHaveText("₹2,600");
  await expect(page.getByText("Refunds −₹400.00")).toBeVisible();
  await expect(page.getByRole("heading", { name: "By category" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spending through the month" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("manual entry, review queue, filters and correction through the UI", async ({ page }, testInfo) => {
  const month = MONTHS[testInfo.project.name as keyof typeof MONTHS][1];
  const merchant = `Unknown Shop ${testInfo.project.name} ${Date.now()}`;
  await signIn(page);

  // Add a transaction manually.
  await page.goto("/transactions/new");
  await page.getByLabel("Amount (₹)").fill("123.45");
  await page.getByLabel("Date").fill(`${month}-15`);
  await page.getByLabel("Merchant or payee").fill(merchant);
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("detail-amount")).toHaveText("−₹123.45");
  await expect(page.getByText("Needs review: uncategorized")).toBeVisible();

  // It appears on the dashboard for that month.
  await page.goto(`/?month=${month}`);
  await expect(page.getByTestId("net-spending")).toHaveText("₹123");

  // Filter to it using the form, and it's in the review queue.
  await page.goto("/transactions");
  await page.getByText("Filters", { exact: true }).click();
  await page.getByLabel("Search merchant or description").fill(merchant);
  await page.getByLabel("Only transactions that need review").check();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/review=1/);
  await expect(page.getByTestId("result-count")).toHaveText("1 transaction");
  await page.getByTestId("transaction-row").first().click();

  // Correct the category and mark it reviewed.
  const form = page.getByTestId("correct-form");
  await form.locator("select[name=categoryId]").selectOption({ label: "Groceries" });
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByText("set by you")).toBeVisible();
  await expect(page.getByText("Corrected")).toBeVisible();

  // No longer needs review; still found by category filter.
  await page.goto(`/transactions?review=1&q=${encodeURIComponent(merchant)}`);
  await expect(page.getByTestId("result-count")).toHaveText("0 transactions");
  await page.goto(`/?month=${month}`);
  await expect(page.getByRole("link", { name: "Groceries", exact: true })).toBeVisible();
});

test("reports, budgets and settings pages render without overflow", async ({ page }) => {
  await signIn(page);
  for (const path of ["/reports?r=category", "/reports?r=monthly", "/reports?r=cashflow", "/reports?r=coverage", "/budgets", "/settings"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBe(0);
  }
  await page.goto("/reports?r=coverage");
  await expect(page.getByText("Not measurable yet.")).toBeVisible();
});
