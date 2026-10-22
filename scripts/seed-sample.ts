// Development only. Creates clearly labelled SAMPLE accounts, rules and transactions for the
// current and previous month, covering every accounting case. Everything it creates has
// is_sample = true and capture method "sample", and `--remove` deletes exactly that.
//
//   npm run db:seed:sample
//   npm run db:seed:sample -- --remove
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed sample data in production.");
  const remove = process.argv.includes("--remove");

  const { db, closeDb } = await import("../src/server/db/client");
  const schema = await import("../src/server/db/schema");
  const { and, asc, eq, isNotNull } = await import("drizzle-orm");
  const { istDate, addMonths } = await import("../src/lib/dates");
  const { ensureDefaultCategories, listCategories } = await import("../src/server/finance/categories-service");
  const { createAccount } = await import("../src/server/finance/accounts-service");
  const { upsertRule } = await import("../src/server/finance/rules-service");
  const { createTransaction } = await import("../src/server/finance/transactions-service");

  try {
    const [user] = await db().select().from(schema.users).orderBy(asc(schema.users.createdAt)).limit(1);
    if (!user) throw new Error("Create the user first: npm run user:create -- you@example.com");

    // Remove previous sample data first, so the seed can be re-run.
    await db().transaction(async (tx) => {
      const sample = and(eq(schema.transactions.userId, user.id), eq(schema.transactions.isSample, true));
      await tx.delete(schema.transactions).where(and(sample, isNotNull(schema.transactions.parentTransactionId)));
      await tx.delete(schema.transactions).where(sample);
      await tx.delete(schema.categoryRules).where(and(eq(schema.categoryRules.userId, user.id), eq(schema.categoryRules.isSample, true)));
      await tx
        .delete(schema.financialAccounts)
        .where(and(eq(schema.financialAccounts.userId, user.id), eq(schema.financialAccounts.isSample, true)));
    });
    if (remove) {
      console.log("Sample data removed.");
      return;
    }

    await ensureDefaultCategories(db(), user.id);
    const cats = new Map((await listCategories(db(), user.id)).map((c) => [c.systemKey, c.id]));
    const cat = (key: string) => cats.get(key) ?? null;

    const acct = (institutionName: string, accountName: string, accountType: "bank_account" | "credit_card", masked: string) =>
      createAccount(db(), user.id, { institutionName, accountName: `SAMPLE ${accountName}`, accountType, maskedIdentifier: masked, isSample: true });
    const hdfcBank = await acct("HDFC Bank", "Savings", "bank_account", "1234");
    const sbiBank = await acct("SBI", "Savings", "bank_account", "5678");
    const hdfcCard = await acct("HDFC Bank", "Credit Card", "credit_card", "4321");
    const amexCard = await acct("American Express", "Credit Card", "credit_card", "1005");

    const rules: [string, string][] = [
      ["SWIGGY", "food_dining"],
      ["ZOMATO", "food_dining"],
      ["BIGBASKET", "groceries"],
      ["ZEPTO", "groceries"],
      ["UBER", "transport_travel"],
      ["NETFLIX", "subscriptions"],
      ["AMAZON", "shopping"],
      ["APOLLO PHARMACY", "health"],
      ["PAYTM MERCHANT", "shopping"],
    ];
    for (const [value, key] of rules) {
      await upsertRule(db(), user.id, { matchType: "merchant_contains", matchValue: value, categoryId: cat(key)!, isSample: true });
    }

    const today = istDate(new Date());
    const thisMonth = today.slice(0, 7);
    let created = 0;

    for (const [month, scale] of [[addMonths(thisMonth, -1), 0.9], [thisMonth, 1]] as const) {
      const lastDay = month === thisMonth ? Number(today.slice(8, 10)) : 28;
      const day = (d: number) => `${month}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
      const rs = (rupees: number) => Math.round(rupees * scale) * 100;

      type Spec = Parameters<typeof createTransaction>[2];
      const specs: Spec[] = [
        { transactionDate: day(1), amountPaise: 85_000_00, direction: "credit", transactionType: "income", merchantName: "SAMPLE EMPLOYER PVT LTD", financialAccountId: hdfcBank.id, paymentMethod: "net_banking" },
        { transactionDate: day(3), amountPaise: 25_000_00, direction: "debit", transactionType: "purchase", merchantName: "IMPS to landlord", categoryId: cat("rent_housing"), financialAccountId: hdfcBank.id, paymentMethod: "net_banking" },
        { transactionDate: day(4), amountPaise: rs(412), direction: "debit", transactionType: "purchase", merchantName: "UPI/SWIGGY", financialAccountId: hdfcBank.id, paymentMethod: "upi" },
        { transactionDate: day(5), amountPaise: rs(650), direction: "debit", transactionType: "purchase", merchantName: "ZOMATO LTD", financialAccountId: hdfcCard.id, paymentMethod: "credit_card" },
        { transactionDate: day(6), amountPaise: rs(2_340), direction: "debit", transactionType: "purchase", merchantName: "BIGBASKET", financialAccountId: hdfcCard.id, paymentMethod: "credit_card" },
        { transactionDate: day(7), amountPaise: rs(320), direction: "debit", transactionType: "purchase", merchantName: "UBER INDIA", financialAccountId: sbiBank.id, paymentMethod: "upi" },
        { transactionDate: day(8), amountPaise: 649_00, direction: "debit", transactionType: "purchase", merchantName: "NETFLIX.COM", financialAccountId: amexCard.id, paymentMethod: "credit_card" },
        { transactionDate: day(9), amountPaise: rs(1_899), direction: "debit", transactionType: "purchase", merchantName: "AMAZON PAY INDIA", financialAccountId: hdfcCard.id, paymentMethod: "credit_card" },
        { transactionDate: day(12), amountPaise: rs(1_899), direction: "credit", transactionType: "refund", merchantName: "AMAZON PAY INDIA", financialAccountId: hdfcCard.id, paymentMethod: "credit_card" },
        { transactionDate: day(10), amountPaise: rs(540), direction: "debit", transactionType: "purchase", merchantName: "APOLLO PHARMACY", financialAccountId: hdfcBank.id, paymentMethod: "upi" },
        { transactionDate: day(11), amountPaise: rs(750), direction: "debit", transactionType: "purchase", originalDescription: "UPI/987654321012/sample-payee@ybl", financialAccountId: sbiBank.id, paymentMethod: "upi" },
        { transactionDate: day(5), amountPaise: 5_000_00, direction: "debit", transactionType: "investment", merchantName: "SAMPLE MUTUAL FUND SIP", financialAccountId: hdfcBank.id, paymentMethod: "auto_debit" },
        { transactionDate: day(13), amountPaise: 2_000_00, direction: "debit", transactionType: "cash_withdrawal", merchantName: "ATM WITHDRAWAL", financialAccountId: sbiBank.id, paymentMethod: "debit_card" },
        { transactionDate: day(14), amountPaise: 499_00, direction: "debit", transactionType: "fee", merchantName: "CARD ANNUAL FEE", categoryId: cat("bills_utilities"), financialAccountId: amexCard.id, paymentMethod: "credit_card" },
        { transactionDate: day(15), amountPaise: 10_000_00, direction: "debit", transactionType: "internal_transfer", originalDescription: "Transfer to own SBI account", financialAccountId: hdfcBank.id, paymentMethod: "net_banking" },
        { transactionDate: day(15), amountPaise: 10_000_00, direction: "credit", transactionType: "internal_transfer", originalDescription: "Transfer from own HDFC account", financialAccountId: sbiBank.id, paymentMethod: "net_banking" },
        { transactionDate: day(16), amountPaise: 15_000_00, direction: "debit", transactionType: "card_settlement", originalDescription: "HDFC credit card bill payment", financialAccountId: hdfcBank.id, paymentMethod: "net_banking" },
        { transactionDate: day(16), amountPaise: 15_000_00, direction: "credit", transactionType: "card_settlement", originalDescription: "Payment received, thank you", financialAccountId: hdfcCard.id, paymentMethod: "net_banking" },
        { transactionDate: day(17), amountPaise: rs(1_200), direction: "debit", transactionType: "purchase", transactionStatus: "failed", merchantName: "IRCTC", financialAccountId: hdfcBank.id, paymentMethod: "upi" },
        { transactionDate: day(18), amountPaise: rs(999), direction: "debit", transactionType: "purchase", merchantName: "PAYTM MERCHANT", financialAccountId: sbiBank.id, paymentMethod: "upi" },
        { transactionDate: day(19), amountPaise: rs(999), direction: "credit", transactionType: "reversal", merchantName: "PAYTM MERCHANT", financialAccountId: sbiBank.id, paymentMethod: "upi" },
        { transactionDate: day(20), amountPaise: rs(450), direction: "debit", transactionType: "purchase", transactionStatus: "pending", merchantName: "ZEPTO", financialAccountId: hdfcCard.id, paymentMethod: "credit_card" },
      ];
      for (const spec of specs) {
        await createTransaction(db(), user.id, spec, { captureMethod: "sample", isSample: true });
        created++;
      }
    }
    console.log(`Created ${created} SAMPLE transactions across 4 SAMPLE accounts. Remove with: npm run db:seed:sample -- --remove`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
