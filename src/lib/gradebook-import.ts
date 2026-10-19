import * as XLSX from "xlsx";
import { type Course, type Profile, transmute, weightedInitial, gradeRemarks } from "@/lib/lms";
import { buildXlsx, downloadBlob, downloadCsv, type XlsxCell } from "@/lib/xlsx";
import type { ColumnKey, CellState, OverridesState } from "@/components/courses/grade-overrides";

export type ImportConflictStrategy = "overwrite" | "fill_blanks";

export interface GradebookParsedRow {
  key: string;
  line: number;
  selected: boolean;
  student: Profile | null;
  rawIdentifier: string;
  rawName: string;
  rawSection: string;
  rawWw: string;
  rawPt: string;
  rawEx: string;
  rawOverrideNote: string;
  parsedWw: number | null;
  parsedPt: number | null;
  parsedEx: number | null;
  overrideNote: string | null;
  status: "update" | "new" | "unchanged" | "unmatched" | "invalid";
  errors: string[];
  warnings: string[];
  currentScores: {
    ww: string;
    pt: string;
    ex: string;
    overrideNote?: string | undefined;
  };
  targetScores: {
    ww: string;
    pt: string;
    ex: string;
    overrideNote?: string | undefined;
  };
  preview: {
    initial: number;
    transmuted: number;
    remarks: string;
  } | null;
}

export interface GradebookImportResult {
  fileName: string;
  sheetName: string;
  totalRows: number;
  matchedCount: number;
  changedCount: number;
  unchangedCount: number;
  unmatchedCount: number;
  invalidCount: number;
  rows: GradebookParsedRow[];
}

function normalizeHeader(h: unknown): string {
  if (h == null) return "";
  return String(h)
    .toLowerCase()
    .trim()
    .replace(/[\s_\-–—()%/.]+/g, "");
}

function parseScore(val: unknown): { score: number | null; raw: string; error?: string } {
  if (val == null) return { score: null, raw: "" };
  const raw = String(val).trim();
  if (!raw) return { score: null, raw: "" };
  const n = Number(raw);
  if (Number.isNaN(n)) {
    return { score: null, raw, error: `Invalid number: "${raw}"` };
  }
  if (n < 0 || n > 100) {
    return { score: null, raw, error: `Score ${n} is outside 0–100 range` };
  }
  return { score: Math.round(n * 100) / 100, raw };
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.'"-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses a spreadsheet (CSV, TSV, XLSX, XLS) and compares against course roster and current cells.
 */
export function parseGradebookSpreadsheet(
  buffer: ArrayBuffer | Uint8Array | string,
  fileName: string,
  roster: Profile[],
  currentCells: Record<string, CellState>,
  currentOverrides: OverridesState,
  attOf: (studentId: string) => number | null,
  strategy: ImportConflictStrategy = "overwrite",
): GradebookImportResult {
  const wb =
    typeof buffer === "string"
      ? XLSX.read(buffer, { type: "string", raw: true })
      : XLSX.read(buffer, { type: "array", raw: true });

  const sheetName = wb.SheetNames[0] ?? "Sheet1";
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return {
      fileName,
      sheetName,
      totalRows: 0,
      matchedCount: 0,
      changedCount: 0,
      unchangedCount: 0,
      unmatchedCount: 0,
      invalidCount: 0,
      rows: [],
    };
  }

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (rawRows.length === 0) {
    return {
      fileName,
      sheetName,
      totalRows: 0,
      matchedCount: 0,
      changedCount: 0,
      unchangedCount: 0,
      unmatchedCount: 0,
      invalidCount: 0,
      rows: [],
    };
  }

  // Detect header row by scanning first 10 rows
  let headerIndex = -1;
  let idCol = -1;
  let nameCol = -1;
  let sectionCol = -1;
  let wwCol = -1;
  let ptCol = -1;
  let exCol = -1;
  let noteCol = -1;

  for (let r = 0; r < Math.min(10, rawRows.length); r++) {
    const row = rawRows[r] as unknown[];
    if (!Array.isArray(row)) continue;

    let hasId = false;
    let hasWw = false;
    let hasPt = false;
    let hasEx = false;
    let hasName = false;

    row.forEach((cell, idx) => {
      const norm = normalizeHeader(cell);
      if (!norm) return;

      if (
        norm === "studentno" ||
        norm === "studentid" ||
        norm === "idnumber" ||
        norm === "lrn" ||
        norm === "id"
      ) {
        hasId = true;
      } else if (norm === "name" || norm === "studentname" || norm === "fullname") {
        hasName = true;
      } else if (
        norm === "ww" ||
        norm === "writtenwork" ||
        norm === "written" ||
        norm === "ww20" ||
        norm === "wwscore"
      ) {
        hasWw = true;
      } else if (
        norm === "pt" ||
        norm === "performancetask" ||
        norm === "performance" ||
        norm === "pt40" ||
        norm === "ptscore"
      ) {
        hasPt = true;
      } else if (
        norm === "exam" ||
        norm === "quarterlyexam" ||
        norm === "periodicalexam" ||
        norm === "periodical" ||
        norm === "exam30" ||
        norm === "examscore"
      ) {
        hasEx = true;
      }
    });

    if ((hasId || hasName) && (hasWw || hasPt || hasEx)) {
      headerIndex = r;
      row.forEach((cell, idx) => {
        const norm = normalizeHeader(cell);
        if (!norm) return;

        if (
          idCol === -1 &&
          (norm === "studentno" ||
            norm === "studentid" ||
            norm === "idnumber" ||
            norm === "lrn" ||
            norm === "id")
        ) {
          idCol = idx;
        } else if (
          nameCol === -1 &&
          (norm === "name" || norm === "studentname" || norm === "fullname")
        ) {
          nameCol = idx;
        } else if (sectionCol === -1 && (norm === "section" || norm === "class")) {
          sectionCol = idx;
        } else if (
          wwCol === -1 &&
          (norm === "ww" ||
            norm === "writtenwork" ||
            norm === "written" ||
            norm === "ww20" ||
            norm === "wwscore")
        ) {
          wwCol = idx;
        } else if (
          ptCol === -1 &&
          (norm === "pt" ||
            norm === "performancetask" ||
            norm === "performance" ||
            norm === "pt40" ||
            norm === "ptscore")
        ) {
          ptCol = idx;
        } else if (
          exCol === -1 &&
          (norm === "exam" ||
            norm === "quarterlyexam" ||
            norm === "periodicalexam" ||
            norm === "periodical" ||
            norm === "exam30" ||
            norm === "examscore")
        ) {
          exCol = idx;
        } else if (
          noteCol === -1 &&
          (norm === "overrides" ||
            norm === "override" ||
            norm === "overridenotes" ||
            norm === "notes" ||
            norm === "note" ||
            norm === "remarks" ||
            norm === "remark")
        ) {
          noteCol = idx;
        }
      });
      break;
    }
  }

  // Fallback if no explicit header recognized: assume columns 0=ID, 1=Name, 2=Section, 3=WW, 4=PT, 5=Exam
  if (headerIndex === -1) {
    headerIndex = 0;
    idCol = 0;
    nameCol = 1;
    sectionCol = 2;
    wwCol = 3;
    ptCol = 4;
    exCol = 5;
    noteCol = 6;
  }

  // Fast lookup maps for roster
  const byId = new Map<string, Profile>();
  const byEmail = new Map<string, Profile>();
  const byName = new Map<string, Profile>();

  roster.forEach((s) => {
    if (s.student_id) byId.set(s.student_id.toLowerCase().trim(), s);
    if (s.email) byEmail.set(s.email.toLowerCase().trim(), s);
    if (s.full_name) {
      byName.set(normalizeName(s.full_name), s);
      // Support "LAST, First" by also checking reversed format
      const parts = s.full_name.split(/\s+/);
      if (parts.length >= 2) {
        const lastFirst = `${parts[parts.length - 1]} ${parts.slice(0, parts.length - 1).join(" ")}`;
        byName.set(normalizeName(lastFirst), s);
      }
    }
  });

  const parsedRows: GradebookParsedRow[] = [];
  const startRow = headerIndex + 1;

  for (let r = startRow; r < rawRows.length; r++) {
    const row = rawRows[r] as unknown[];
    if (!Array.isArray(row)) continue;

    const rawId = idCol >= 0 ? String(row[idCol] ?? "").trim() : "";
    const rawName = nameCol >= 0 ? String(row[nameCol] ?? "").trim() : "";
    const rawSection = sectionCol >= 0 ? String(row[sectionCol] ?? "").trim() : "";
    const rawWw = wwCol >= 0 ? String(row[wwCol] ?? "").trim() : "";
    const rawPt = ptCol >= 0 ? String(row[ptCol] ?? "").trim() : "";
    const rawEx = exCol >= 0 ? String(row[exCol] ?? "").trim() : "";
    const rawNote = noteCol >= 0 ? String(row[noteCol] ?? "").trim() : "";

    // Skip totally empty rows
    if (!rawId && !rawName && !rawWw && !rawPt && !rawEx) continue;

    // Match student
    let student: Profile | null = null;
    if (rawId) {
      student = byId.get(rawId.toLowerCase()) ?? null;
      if (!student && rawId.includes("@")) {
        student = byEmail.get(rawId.toLowerCase()) ?? null;
      }
    }
    if (!student && rawName) {
      student = byName.get(normalizeName(rawName)) ?? null;
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    const wwRes = parseScore(rawWw);
    const ptRes = parseScore(rawPt);
    const exRes = parseScore(rawEx);

    if (wwRes.error) errors.push(wwRes.error);
    if (ptRes.error) errors.push(ptRes.error);
    if (exRes.error) errors.push(exRes.error);

    if (!student) {
      errors.push(`Student not found in course roster: "${rawId || rawName}"`);
    }

    const currentCell = student ? currentCells[student.id] : undefined;
    const curWw = currentCell?.ww ?? "";
    const curPt = currentCell?.pt ?? "";
    const curEx = currentCell?.ex ?? "";

    // Determine target scores based on strategy
    let targetWw = curWw;
    let targetPt = curPt;
    let targetEx = curEx;

    if (strategy === "overwrite") {
      if (wwRes.score != null) targetWw = String(wwRes.score);
      if (ptRes.score != null) targetPt = String(ptRes.score);
      if (exRes.score != null) targetEx = String(exRes.score);
    } else {
      // fill_blanks: only populate if current is blank
      if (curWw === "" && wwRes.score != null) targetWw = String(wwRes.score);
      if (curPt === "" && ptRes.score != null) targetPt = String(ptRes.score);
      if (curEx === "" && exRes.score != null) targetEx = String(exRes.score);
    }

    const hasChanged = targetWw !== curWw || targetPt !== curPt || targetEx !== curEx;
    const hasCurrent = curWw !== "" || curPt !== "" || curEx !== "";
    const hasNew = targetWw !== "" || targetPt !== "" || targetEx !== "";

    let status: GradebookParsedRow["status"] = "unchanged";
    if (errors.length > 0) {
      status = student ? "invalid" : "unmatched";
    } else if (!hasCurrent && hasNew) {
      status = "new";
    } else if (hasChanged) {
      status = "update";
    }

    // Compute preview
    let preview: GradebookParsedRow["preview"] = null;
    if (student) {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      const initial = weightedInitial(
        num(targetWw),
        num(targetPt),
        num(targetEx),
        attOf(student.id),
      );
      if (initial != null) {
        const t = transmute(initial);
        preview = { initial, transmuted: t, remarks: gradeRemarks(t) };
      }
    }

    parsedRows.push({
      key: student ? student.id : `row-${r}`,
      line: r + 1,
      selected: errors.length === 0 && student != null && (status === "update" || status === "new"),
      student,
      rawIdentifier: rawId,
      rawName,
      rawSection,
      rawWw,
      rawPt,
      rawEx,
      rawOverrideNote: rawNote,
      parsedWw: wwRes.score,
      parsedPt: ptRes.score,
      parsedEx: exRes.score,
      overrideNote: rawNote ? rawNote.slice(0, 500) : null,
      status,
      errors,
      warnings,
      currentScores: {
        ww: curWw,
        pt: curPt,
        ex: curEx,
      },
      targetScores: {
        ww: targetWw,
        pt: targetPt,
        ex: targetEx,
        overrideNote: rawNote || undefined,
      },
      preview,
    });
  }

  const matchedCount = parsedRows.filter((r) => r.student != null).length;
  const changedCount = parsedRows.filter((r) => r.status === "update" || r.status === "new").length;
  const unchangedCount = parsedRows.filter((r) => r.status === "unchanged").length;
  const unmatchedCount = parsedRows.filter((r) => r.status === "unmatched").length;
  const invalidCount = parsedRows.filter((r) => r.status === "invalid").length;

  return {
    fileName,
    sheetName,
    totalRows: parsedRows.length,
    matchedCount,
    changedCount,
    unchangedCount,
    unmatchedCount,
    invalidCount,
    rows: parsedRows,
  };
}

/**
 * Downloads a sample template pre-filled with enrolled students for a course.
 */
export function downloadGradebookTemplate(
  course: Course | undefined,
  quarter: number,
  roster: Profile[],
  format: "csv" | "xlsx" = "xlsx",
): void {
  const header: XlsxCell[] = [
    "Student No",
    "Name",
    "Section",
    "WW (20%)",
    "PT (40%)",
    "Exam (30%)",
    "Override Notes",
  ];

  const sortedRoster = [...roster].sort((a, b) => a.full_name.localeCompare(b.full_name));

  const rows: XlsxCell[][] = sortedRoster.map((s) => [
    s.student_id ?? "",
    s.full_name,
    s.section ?? "",
    "",
    "",
    "",
    "",
  ]);

  const baseName = `${course?.code ?? "grades"}-Q${quarter}-template`;

  if (format === "csv") {
    downloadCsv([header, ...rows], `${baseName}.csv`);
  } else {
    const blob = buildXlsx([{ name: `Q${quarter} Grades`, rows: [header, ...rows] }]);
    downloadBlob(blob, `${baseName}.xlsx`);
  }
}
