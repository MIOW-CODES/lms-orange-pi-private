/**
 * Minimal, dependency-free .xlsx writer.
 *
 * Produces a valid Office Open XML spreadsheet using STORE (uncompressed) ZIP
 * entries, which Excel, LibreOffice and Google Sheets all accept. Strings are
 * written as inline strings so no sharedStrings table is needed.
 *
 * Usage:
 *   const blob = buildXlsx([{ name: "Grades", rows: [["Name", 90], ["Ana", 95]] }]);
 *   downloadBlob(blob, "grades.xlsx");
 */

export type XlsxCell = string | number | null | undefined;
export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
}

/* ---------- CRC-32 (for ZIP entries) ---------- */

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}
function crc32(bytes: Uint8Array): number {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- ZIP (STORE) ---------- */

interface ZipEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  offset: number;
}

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}
const encoder = new TextEncoder();

function zip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  const done: ZipEntry[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = encoder.encode(e.name);
    const crc = crc32(e.data);
    // Local file header
    const local = [
      ...u32(0x04034b50),
      ...u16(20), // version needed
      ...u16(0x0800), // UTF-8 flag
      ...u16(0), // method: store
      ...u16(0),
      ...u16(0), // time/date
      ...u32(crc),
      ...u32(e.data.length),
      ...u32(e.data.length),
      ...u16(nameBytes.length),
      ...u16(0),
    ];
    chunks.push(...local, ...nameBytes, ...e.data);
    const entry: ZipEntry = { name: e.name, data: e.data, crc, offset };
    done.push(entry);
    offset += local.length + nameBytes.length + e.data.length;
  }

  const centralStart = offset;
  for (const e of done) {
    const nameBytes = encoder.encode(e.name);
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(e.crc),
      ...u32(e.data.length),
      ...u32(e.data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(e.offset),
      ...nameBytes,
    );
    offset += 46 + nameBytes.length;
  }

  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(done.length),
    ...u16(done.length),
    ...u32(offset - centralStart),
    ...u32(centralStart),
    ...u16(0),
  ];

  return new Uint8Array([...chunks, ...central, ...end]);
}

/* ---------- XLSX parts ---------- */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function colName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellXml(value: XlsxCell, ref: string): string {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
}

function sheetXml(rows: XlsxCell[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row.map((v, c) => cellXml(v, `${colName(c)}${r + 1}`)).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Build a valid .xlsx Blob from one or more sheets. */
export function buildXlsx(sheets: XlsxSheet[]): Blob {
  const safeSheets = sheets.length ? sheets : [{ name: "Sheet1", rows: [[""]] }];

  const sheetEntries = safeSheets.map((s, i) => ({
    name: `xl/worksheets/sheet${i + 1}.xml`,
    data: encoder.encode(sheetXml(s.rows)),
  }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${safeSheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("")}</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safeSheets
    .map(
      (s, i) =>
        `<sheet name="${xmlEscape(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join("")}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safeSheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("")}</Relationships>`;

  const entries = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    ...sheetEntries,
  ];

  const bytes = zip(entries);
  return new Blob([bytes.buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download a UTF-8 CSV from a matrix of cells. */
export function downloadCsv(rows: XlsxCell[][], filename: string): void {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const raw = cell == null ? "" : String(cell);
          // Prevent spreadsheet applications from evaluating exported text as
          // a formula when it begins with a formula operator.
          const value = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}
