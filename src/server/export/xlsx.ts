import type { Cell, Table } from "./table";
import { zip } from "./zip";

// Writes a single-sheet .xlsx workbook. Text cells are inline strings and numbers are numeric
// cells, so no cell is ever a formula: Excel never evaluates "=..." text written this way.

// XML 1.0 forbids most control characters, even escaped.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const escapeXml = (s: string) =>
  s.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

// Style ids from styles.xml below: 1 = bold header, 2 = number with two decimals.
function cellXml(cell: Cell, ref: string, header: boolean): string {
  if (cell === null) return "";
  if (cell.t === "n") return `<c r="${ref}" s="2"><v>${escapeXml(cell.v)}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${escapeXml(cell.v)}</t></is></c>`;
}

function sheetXml(table: Table, widths: number[]): string {
  const rows = [table.headers.map((h): Cell => ({ t: "s", v: h })), ...table.rows];
  const body = rows
    .map((cells, r) => `<row r="${r + 1}">${cells.map((c, i) => cellXml(c, `${columnName(i)}${r + 1}`, r === 0)).join("")}</row>`)
    .join("");
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

export function toXlsx(table: Table, sheetName = "Transactions"): Buffer {
  const widths = table.headers.map((h, i) => {
    const longest = Math.max(h.length, ...table.rows.slice(0, 500).map((r) => r[i]?.v.length ?? 0));
    return Math.min(60, Math.max(8, longest + 2));
  });
  const files: Record<string, string> = {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    "xl/styles.xml": STYLES,
    "xl/worksheets/sheet1.xml": sheetXml(table, widths),
  };
  return zip(Object.entries(files).map(([name, content]) => ({ name, data: Buffer.from(content, "utf8") })));
}
