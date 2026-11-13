import { expect, test } from "@playwright/test";
import { api, signIn } from "./helpers";

// Own past months per project, apart from dashboard.spec.ts, so totals never mix.
const MONTHS = { desktop: "2026-02", mobile: "2026-03" } as const;
type Tx = { transaction: { id: string } };
type Categories = { items: { id: string; systemKey: string }[] };

test("account checkboxes, filter totals, the overview's why picker and the category pie", async ({ page, baseURL }, testInfo) => {
  const month = MONTHS[testInfo.project.name as keyof typeof MONTHS];
  const tag = `${testInfo.project.name}-${Date.now()}`;
  const why = `E2E why ${tag}`;
  await signIn(page);
  const client = api(page, baseURL!);
  const bank = await client.post<{ id: string }>("/api/accounts", { institutionName: "Why Bank", accountName: `Savings ${tag}`, accountType: "bank_account" });
  const card = await client.post<{ id: string }>("/api/accounts", { institutionName: "Why Card", accountName: `Card ${tag}`, accountType: "credit_card" });
  const cats = (await client.get<Categories>("/api/categories")).items;
  const food = cats.find((c) => c.systemKey === "food_dining")!;
  const groceries = cats.find((c) => c.systemKey === "groceries")!;

  const tx = (data: Record<string, unknown>) =>
    client.post<Tx>("/api/transactions", { transactionDate: `${month}-10`, direction: "debit", transactionType: "purchase", ...data });
  const a = await tx({ amountPaise: 1500_00, financialAccountId: bank.id, merchantName: `Rent share ${tag}`, categoryId: groceries.id });
  await tx({ amountPaise: 500_00, financialAccountId: card.id, merchantName: `Lunch ${tag}`, categoryId: food.id });
  await tx({ amountPaise: 200_00, financialAccountId: bank.id, merchantName: `Payback ${tag}`, transactionType: "income", direction: "credit" });
  const patched = await page.request.patch(`/api/transactions/${a.transaction.id}`, { headers: { Origin: baseURL! }, data: { reason: why } });
  expect(patched.ok()).toBe(true);

  // Tick both accounts: everything shows, with Out / In / Net across the matches.
  await page.goto(`/transactions?from=${month}-01&to=${month}-28`);
  await expect(page.getByText("Filters (2 active)")).toBeVisible(); // open because filters are active
  await page.getByRole("checkbox", { name: `Why Bank Savings ${tag}` }).check();
  await page.getByRole("checkbox", { name: `Why Card Card ${tag}` }).check();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByTestId("result-count")).toHaveText("3 transactions");
  const totals = page.getByTestId("filter-totals");
  await expect(totals).toContainText("₹2,000.00");
  await expect(totals).toContainText("₹200.00");
  await expect(totals).toContainText("−₹1,800.00");
  await expect(page.getByRole("checkbox", { name: `Why Card Card ${tag}` })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("transactions.png"), fullPage: true });

  // Overview: pick the why, net spending covers only that payment; the pie shows both categories.
  await page.goto(`/?month=${month}&why=all`);
  await expect(page.getByTestId("net-spending")).toHaveText("₹2,000");
  await page.getByTestId("net-spending-why").selectOption(why);
  await expect(page).toHaveURL(/why=E2E/);
  await expect(page.getByTestId("net-spending")).toHaveText("₹1,500");
  await expect(page.getByRole("link", { name: "Groceries", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Food & Dining", exact: true })).toBeVisible();
  await expect(page.getByText("75%")).toBeVisible();
  // The why survives moving between months.
  await page.getByRole("link", { name: /Previous month/ }).click();
  await expect(page).toHaveURL(/why=E2E/);
  await page.goto(`/?month=${month}&why=${encodeURIComponent(why)}`);
  await page.screenshot({ path: testInfo.outputPath("overview.png"), fullPage: true });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});
