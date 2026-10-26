import type { Cell, Table } from "./table";

// Spreadsheet apps run a text cell starting with one of these as a formula (CSV injection).
// Such text gets a leading apostrophe, which Excel and Sheets show as plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

function field(cell: Cell): string {
  if (cell === null) return "";
  // Numbers are written as numbers; only text can carry a formula.
  const value = cell.t === "s" ? neutralizeFormula(cell.v) : cell.v;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// RFC 4180 with CRLF line endings and a UTF-8 byte-order mark, so Excel reads "₹" and other
// non-ASCII text correctly.
export function toCsv(table: Table): string {
  const lines = [table.headers.map((h) => field({ t: "s", v: h })), ...table.rows.map((r) => r.map(field))];
  return `﻿${lines.map((l) => l.join(",")).join("\r\n")}\r\n`;
}
