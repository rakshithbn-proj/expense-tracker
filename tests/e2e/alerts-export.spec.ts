import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { api, signIn } from "./helpers";

test("exports the filtered transactions as CSV and Excel, with formulas neutralised", async ({ page, baseURL }) => {
  await signIn(page);
  const tag = randomUUID().slice(0, 8);
  const merchant = `=HYPERLINK("http://x.example","${tag}")`;
  await api(page, baseURL!).post("/api/transactions", {
    transactionDate: "2026-10-05",
    amountPaise: 45050,
    direction: "debit",
    transactionType: "purchase",
    merchantName: merchant,
  });

  // The explorer's export links carry its filters.
  await page.goto(`/transactions?q=${tag}`);
  const csvLink = page.getByRole("link", { name: "Export CSV" });
  await expect(csvLink).toHaveAttribute("href", `/api/export?format=csv&q=${tag}`);

  const download = page.waitForEvent("download");
  await csvLink.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^transactions-\d{4}-\d{2}-\d{2}\.csv$/);

  const csv = await page.request.get(`/api/export?format=csv&q=${tag}`);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["cache-control"]).toBe("no-store");
  const lines = (await csv.text()).replace(/^﻿/, "").trim().split("\r\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^Transaction ID,Date,Merchant,/);
  expect(lines[1]).toContain(`"'=HYPERLINK(""http://x.example"",""${tag}"")"`);
  expect(lines[1]).toContain(",450.50,Debit,-450.50,");

  const xlsx = await page.request.get(`/api/export?format=xlsx&q=${tag}`);
  expect(xlsx.headers()["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");

  const bad = await page.request.get("/api/export?format=pdf");
  expect(bad.status()).toBe(409);
});

test("exports require a signed-in session", async ({ request }) => {
  const res = await request.get("/api/export?format=csv");
  expect(res.status()).toBe(401);
});

test("the Alerts page renders and fits a phone screen", async ({ page }) => {
  await signIn(page);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Alerts", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Open/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("Google Sheets explains when it isn't configured", async ({ page, baseURL }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByText(/It uses the same Google setup as Gmail/)).toBeVisible();
  await page.goto("/api/sheets/connect?account=someone%40gmail.example");
  await expect(page).toHaveURL(`${baseURL}/settings?sheets=not_configured#sheets`);
  await expect(page.getByRole("status").filter({ hasText: "Google isn't configured" })).toBeVisible();
});
