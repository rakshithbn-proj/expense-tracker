import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { neutralizeFormula, toCsv } from "@/server/export/csv";
import { istTimestamp, transactionTable, TRANSACTION_HEADERS, type Table } from "@/server/export/table";
import { columnName, toXlsx } from "@/server/export/xlsx";
import type { TransactionDto } from "@/server/finance/transactions-service";

// Reads the files back out of a ZIP using its central directory.
function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entries = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < entries; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    files.set(name, inflateRawSync(buf.subarray(dataStart, dataStart + size)).toString("utf8"));
    p += 46 + nameLen;
  }
  return files;
}

const tx = (over: Partial<TransactionDto> = {}): TransactionDto => ({
  id: "6f1c1d1e-0000-4000-8000-000000000001",
  financialAccountId: "acc",
  transactionDate: "2026-10-21",
  sourceTimestamp: null,
  capturedAt: "2026-10-21T13:05:00.000Z",
  merchantName: "Swiggy",
  originalDescription: null,
  amountPaise: 1234_50,
  currency: "INR",
  direction: "debit",
  transactionType: "purchase",
  transactionStatus: "posted",
  categoryId: "cat",
  categorySource: "user",
  paymentMethod: "upi",
  paymentApp: null,
  referenceId: null,
  parentTransactionId: null,
  transferGroupId: null,
  captureMethod: "auto_email",
  needsReview: false,
  reviewReason: null,
  notes: null,
  isSample: false,
  voidedAt: null,
  ...over,
});
const names = { categoryName: new Map([["cat", "Food & Dining"]]), accountName: new Map([["acc", "HDFC Bank Card ••4321"]]) };

describe("formula injection", () => {
  it.each(["=1+1", "+91 98", "-5", "@SUM(A1)", "\tx", "\rx"])("neutralises %j", (v) => {
    expect(neutralizeFormula(v)).toBe(`'${v}`);
  });

  it("leaves ordinary text alone", () => {
    expect(neutralizeFormula("Swiggy = food")).toBe("Swiggy = food");
  });

  it("escapes text in CSV but keeps negative numbers as numbers", () => {
    const table: Table = { headers: ["a", "b"], rows: [[{ t: "s", v: '=HYPERLINK("x")' }, { t: "n", v: "-12.50" }]] };
    expect(toCsv(table)).toBe(`﻿a,b\r\n"'=HYPERLINK(""x"")",-12.50\r\n`);
  });
});

describe("CSV", () => {
  it("quotes commas, quotes and line breaks, and leaves empty cells blank", () => {
    const table: Table = { headers: ["x", "y", "z"], rows: [[{ t: "s", v: "a,b" }, { t: "s", v: 'say "hi"\nthere' }, null]] };
    expect(toCsv(table).split("\r\n")[1]).toBe(`"a,b","say ""hi""\nthere",`);
  });
});

describe("transaction table", () => {
  it("formats each column", () => {
    const { headers, rows } = transactionTable([tx(), tx({ direction: "credit", transactionType: "refund", categoryId: null, amountPaise: 5 })], names);
    expect(headers).toBe(TRANSACTION_HEADERS);
    const row = Object.fromEntries(headers.map((h, i) => [h, rows[0][i]?.v ?? null]));
    expect(row).toMatchObject({
      Date: "2026-10-21",
      "Amount (INR)": "1234.50",
      Direction: "Debit",
      "Signed amount (INR)": "-1234.50",
      Type: "Purchase",
      Category: "Food & Dining",
      "Account or card": "HDFC Bank Card ••4321",
      "Payment method": "UPI",
      "Captured by": "Automatic: bank email",
      "Captured at (IST)": "2026-10-21 18:35",
      Description: null,
    });
    expect(rows[1][TRANSACTION_HEADERS.indexOf("Signed amount (INR)")]).toEqual({ t: "n", v: "0.05" });
    expect(rows[1][TRANSACTION_HEADERS.indexOf("Category")]?.v).toBe("Uncategorized");
  });

  it("shows capture times in India time", () => {
    expect(istTimestamp("2026-10-21T20:00:00.000Z")).toBe("2026-10-22 01:30");
    expect(istTimestamp(null)).toBeNull();
  });
});

describe("XLSX", () => {
  it("names columns like Excel", () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("is a valid package with typed cells and no formulas", () => {
    const table: Table = {
      headers: ["Merchant", "Amount"],
      rows: [
        [{ t: "s", v: "=cmd|'/C calc'!A0 & <tag>" }, { t: "n", v: "-99.10" }],
        [null, { t: "n", v: "5.00" }],
      ],
    };
    const files = unzip(toXlsx(table));
    expect([...files.keys()].sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"].sort(),
    );
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain(`<c r="A2" t="inlineStr"><is><t xml:space="preserve">=cmd|'/C calc'!A0 &amp; &lt;tag&gt;</t></is></c>`);
    expect(sheet).toContain(`<c r="B2" s="2"><v>-99.10</v></c>`);
    expect(sheet).toContain(`<row r="3"><c r="B3" s="2"><v>5.00</v></c></row>`);
    expect(files.get("xl/workbook.xml")).toContain(`name="Transactions"`);
  });

  it("drops characters XML can't hold", () => {
    const sheet = unzip(toXlsx({ headers: ["x"], rows: [[{ t: "s", v: "a\u0001b\u0007c" }]] })).get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain(">abc</t>");
  });

  it("is deterministic", () => {
    const table: Table = { headers: ["x"], rows: [[{ t: "s", v: "₹ test" }]] };
    expect(toXlsx(table).equals(toXlsx(table))).toBe(true);
  });
});
