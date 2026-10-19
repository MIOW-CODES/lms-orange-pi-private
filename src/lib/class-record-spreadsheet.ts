import * as XLSX from "xlsx";
import {
  calculateRecord,
  recordCell,
  type RecordDraft,
  type RecordSource,
  type RecordScale,
  type RecordCategory,
} from "./class-record";
export interface RecordStudent {
  id: string;
  student_id: string | null;
  full_name: string;
  section: string | null;
}
const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
export function recordSheetRows(
  draft: RecordDraft,
  sources: RecordSource[],
  roster: RecordStudent[],
  scale: RecordScale,
) {
  const columns = [...draft.columns].sort(
    (a, b) => ["ww", "ex", "pt"].indexOf(a.category) - ["ww", "ex", "pt"].indexOf(b.category),
  );
  const groups: string[] = ["", "", "Attendance (10%)"];
  const header = ["Student No", "Name", "Attendance %"];
  const maximum: (number | string)[] = ["", "Maximum", 100];
  for (const cat of ["ww", "ex", "pt"] as const) {
    const cols = columns.filter((c) => c.category === cat);
    for (const c of cols) {
      groups.push(
        cat === "ww"
          ? "Written Works (20%)"
          : cat === "ex"
            ? "Quarterly Examination (30%)"
            : "Performance Tasks (40%)",
      );
      header.push(c.title);
      maximum.push(c.maximum);
    }
    groups.push("");
    header.push(cat === "ww" ? "Total Quiz" : cat === "pt" ? "Total PT" : "Total Exam");
    maximum.push(cols.reduce((s, c) => s + c.maximum, 0));
  }
  groups.push("Percentage", "", "", "", "", "", "", "");
  header.push(
    "Attendance 10%",
    "Written Works 20%",
    "Exam 30%",
    "PT 40%",
    "Total 100%",
    "Final Grade",
    "Remarks",
    "Status",
  );
  maximum.push(10, 20, 30, 40, 100, "", "", "");
  const rows: (number | string)[][] = roster.map((s) => {
    const r = calculateRecord(draft, sources, s.id, scale);
    const values: (number | string)[] = [s.student_id ?? "", s.full_name, r.attendance ?? ""];
    for (const cat of ["ww", "ex", "pt"] as const) {
      for (const c of columns.filter((c) => c.category === cat))
        values.push(recordCell(draft, sources, s.id, c) ?? "");
      values.push(r.categories[cat].earned);
    }
    values.push(
      r.contributions.attendance,
      r.contributions.ww,
      r.contributions.ex,
      r.contributions.pt,
      r.initial,
      r.complete ? r.final : "",
      r.complete ? r.remarks : "",
      r.complete ? "Complete" : "Incomplete",
    );
    return values;
  });
  return { rows: [groups, header, maximum, ...rows], columns };
}
export interface RecordImportPreview {
  draft: RecordDraft;
  errors: string[];
  matched: number;
  changes: number;
  unmatched: string[];
}
export function previewRecordImport(
  workbook: XLSX.WorkBook,
  sheetName: string,
  current: RecordDraft,
  roster: RecordStudent[],
  fileName: string,
): RecordImportPreview {
  const draft = structuredClone(current);
  const errors: string[] = [],
    unmatched: string[] = [];
  let matched = 0,
    changes = 0;
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { draft, errors: ["Select a worksheet."], matched, changes, unmatched };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const hi = rows.findIndex(
    (row, i) => i < 15 && row.some((c) => ["name", "student name", "full name"].includes(norm(c))),
  );
  if (hi < 0)
    return {
      draft,
      errors: ["No Name header found in the first 15 rows."],
      matched,
      changes,
      unmatched,
    };
  const base = rows[hi]!;
  const grouped =
    base.some((c) =>
      /written works|performance task|quarterly assessment|practical works|laboratory activity/i.test(
        String(c),
      ),
    ) &&
    norm(
      (rows[hi + 1] ?? [])[
        base.findIndex((c) => ["name", "student name", "full name"].includes(norm(c)))
      ],
    ) !== "maximum";
  const headers = grouped ? rows[hi + 1]! : base;
  const maxRow = rows[hi + (grouped ? 2 : 1)] ?? [];
  const nameIndex = base.findIndex((c) => ["name", "student name", "full name"].includes(norm(c)));
  const idIndex = base.findIndex((c) => ["student no", "student id", "lrn"].includes(norm(c)));
  const mappings: Array<{ index: number; columnId: string; maximum: number }> = [];
  let group: RecordCategory | null = null;
  headers.forEach((h, index) => {
    if (grouped && String(base[index] ?? "")) {
      const b = norm(base[index]);
      if (/written|practical/.test(b)) group = "ww";
      else if (/performance|laboratory/.test(b)) group = "pt";
      else if (/quarterly|examination|culminating/.test(b)) group = "ex";
      else group = null;
    }
    if (grouped && !group) return;
    const title = String(h ?? "").trim();
    const key = norm(title);
    if (
      (!grouped && /%/.test(title)) ||
      !title ||
      index === nameIndex ||
      index === idIndex ||
      /total|percentage|final grade|remarks|status|section|attendance/.test(key)
    )
      return;
    const existing = draft.columns.find((c) => norm(c.title) === key);
    const category =
      existing?.category ??
      group ??
      (/^(q|ww)\s*\d/.test(key)
        ? "ww"
        : /^pt\s*\d/.test(key)
          ? "pt"
          : /exam|^qa$/.test(key)
            ? "ex"
            : null);
    if (!category) return;
    const possible = Number(maxRow[index]);
    const maximum = possible > 0 && Number.isFinite(possible) ? possible : existing?.maximum;
    if (!maximum) {
      errors.push(`Missing maximum for ${title}.`);
      return;
    }
    let col = existing;
    if (col && Math.abs(col.maximum - maximum) > 1e-9) {
      errors.push(`Maximum for ${title} differs from the current column (${col.maximum}).`);
      return;
    }
    if (!col) {
      col = { id: crypto.randomUUID(), title, category, maximum };
      draft.columns.push(col);
    }
    if (mappings.some((m) => m.columnId === col.id)) {
      errors.push(
        `Duplicate assessment header: ${title}. Rename duplicate columns before importing.`,
      );
      return;
    }
    mappings.push({ index, columnId: col.id, maximum });
  });
  const attIndex = base.findIndex(
    (c) =>
      norm(c) === "attendance %" || norm(c) === "attendance" || norm(c) === "attendance percent",
  );
  if (!mappings.length && attIndex < 0)
    errors.push(
      "No assessment columns found. Use the blank template, or select a sheet with item scores and maxima.",
    );
  const seen = new Set<string>();
  const first = hi + (grouped ? 3 : norm(maxRow[nameIndex]) === "maximum" ? 2 : 1);
  for (let i = first; i < rows.length; i++) {
    const row = rows[i]!;
    const name = String(row[nameIndex] ?? "").trim();
    const identifier = idIndex >= 0 ? String(row[idIndex] ?? "").trim() : "";
    if (!name && !identifier) continue;
    const candidates = identifier
      ? roster.filter((s) => s.student_id === identifier)
      : roster.filter((s) => norm(s.full_name) === norm(name));
    if (candidates.length !== 1) {
      unmatched.push(
        `Row ${i + 1}: ${name || identifier}${candidates.length > 1 ? " (ambiguous name)" : ""}`,
      );
      continue;
    }
    const student = candidates[0]!;
    if (seen.has(student.id)) {
      errors.push(`Duplicate student at row ${i + 1}: ${name}`);
      continue;
    }
    seen.add(student.id);
    matched++;
    const setScore = (index: number, max: number, apply: (value: number) => void) => {
      const raw = row[index];
      if (raw == null || String(raw).trim() === "") return;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > max) {
        errors.push(`Row ${i + 1}, column ${index + 1}: enter a score from 0 to ${max}.`);
        return;
      }
      apply(value);
      changes++;
    };
    for (const m of mappings)
      setScore(m.index, m.maximum, (value) => {
        draft.scores[student.id] ??= {};
        draft.scores[student.id]![m.columnId] = {
          value,
          reason: `Spreadsheet import: ${fileName}`.slice(0, 1000),
        };
      });
    if (attIndex >= 0)
      setScore(attIndex, 100, (value) => {
        draft.attendance[student.id] = {
          value,
          reason: `Spreadsheet import: ${fileName}`.slice(0, 1000),
        };
      });
  }
  return { draft, errors, matched, changes, unmatched };
}
