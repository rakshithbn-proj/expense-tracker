import { expect, test } from "@playwright/test";
import { istDate } from "@/lib/dates";
import { daysInMonthOf } from "@/lib/daily-allowance";
import { api, signIn } from "./helpers";

type Tx = { transaction: { id: string } };
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// Uses its own "why" so its budget never touches other specs' totals.
test("daily allowance on the overview, with the calculator", async ({ page, baseURL }, testInfo) => {
  const today = istDate(new Date());
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const why = `Allowance ${testInfo.project.name}-${Date.now()}`;
  await signIn(page);
  const client = api(page, baseURL!);

  // ₹1,000 a day this month; nothing spent before today, so every earlier day carried over.
  const put = await page.request.put("/api/budgets", {
    headers: { Origin: baseURL! },
    data: { categoryId: null, reason: why, fromMonth: month, limitPaise: daysInMonthOf(month) * 1000_00 },
  });
  expect(put.ok(), await put.text()).toBe(true);
  const tx = await client.post<Tx>("/api/transactions", { transactionDate: today, direction: "debit", transactionType: "purchase", amountPaise: 400_00 });
  expect((await page.request.patch(`/api/transactions/${tx.transaction.id}`, { headers: { Origin: baseURL! }, data: { reason: why } })).ok()).toBe(true);

  await page.goto(`/?why=${encodeURIComponent(why)}`);
  const left = day * 1000 - 400;
  await expect(page.getByTestId("daily-allowance-left")).toContainText(rupees(left));

  await page.getByTestId("allowance-calculator-amount").fill(String(left + 900));
  await expect(page.getByTestId("allowance-calculator-result")).toContainText("This expense shall reduce your daily expenditure by");
  await page.getByTestId("allowance-calculator-amount").fill("abc");
  await expect(page.getByTestId("allowance-calculator-result")).toContainText("Enter an amount");
  await page.getByTestId("allowance-calculator-amount").fill(String(left + 900));
  await page.getByTestId("daily-allowance-row").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("daily-allowance.png"), fullPage: true });
});
