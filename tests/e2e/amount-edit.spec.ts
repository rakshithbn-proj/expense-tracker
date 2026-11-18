import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("the amount can be edited once and is flagged with the earlier amount", async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto("/transactions/new");
  await page.getByLabel("Amount (₹)").fill("1200");
  await page.getByLabel("Merchant or payee").fill(`Dinner ${testInfo.project.name} ${Date.now()}`);
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]{36}$/);

  const form = page.getByTestId("correct-form");
  await form.getByLabel("Amount (₹)").fill("400");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByTestId("detail-amount")).toHaveText("−₹400.00");
  await expect(page.getByTestId("amount-edited")).toHaveText("Amount edited · was ₹1,200.00");
  await expect(form.getByLabel("Amount (₹)")).toBeDisabled();
});
