/**
 * Class-list parsing for bulk student add.
 *
 * Tolerant on purpose: teachers paste from spreadsheets, PDFs and printed
 * class lists, so we accept CSV / TSV / semicolon / space-aligned rows, with or
 * without a header line, and with "LAST, First M." names that may be quoted or
 * (awkwardly) unquoted. Gender and year columns are common in real lists —
 * year maps onto `grade_level` (Grade 7–12, or college year 1–4 → 13–16);
 * gender is read so the column can be matched, but student records have no
 * gender field, so it is not saved.
 *
 * Pure module — no I/O — so the rules can be unit-tested (class-list.test.ts).
 */

export type ClassListDelimiter = "tab" | "comma" | "semicolon" | "spaces";

export type ColumnRole =
  | "student_id"
  | "full_name"
  | "name_last"
  | "name_first"
  | "name_middle"
  | "email"
  | "grade"
  | "section"
  | "gender"
  | "ignore";

export interface ClassListRow {
  /** 1-based line number in the pasted text (best effort). */
  line: number;
  student_id: string | null;
  full_name: string | null;
  email: string | null;
  grade_level: number | null;
  /** The year/grade cell exactly as pasted — kept to explain blank grades. */
  grade_raw: string | null;
  section: string | null;
  /** Parsed only to recognise the column — never stored on the profile. */
  gender: string | null;
  /** Blocking problems — the row cannot be saved as-is. */
  errors: string[];
  /** Non-blocking notes (blank grade, truncated section, …). */
  warnings: string[];
}

export interface ClassListParse {
  rows: ClassListRow[];
  delimiter: ClassListDelimiter;
  hasHeader: boolean;
  /** Field-index → detected role, for transparency in the UI. */
  columns: ColumnRole[];
  notes: string[];
}

export interface ReviewRow extends ClassListRow {
  key: string;
  include: boolean;
  status: "new" | "existing" | "already-enrolled" | "duplicate" | "invalid";
  /** Profile id when the row matches somebody already in the system. */
  match_id: string | null;
  /** One-line human summary of what will happen. */
  note: string;
}

/* ------------------------------------------------------------------ */
/* Field splitting                                                      */
/* ------------------------------------------------------------------ */

/** Split one delimited line, honouring double-quoted fields (CSV style). */
export function splitFields(line: string, delimiter: ClassListDelimiter): string[] {
  if (delimiter === "spaces") {
    return line
      .split(/\s{2,}|\t/)
      .map((f) => unquote(f.trim()))
      .filter((f) => f.length > 0);
  }
  const sep = delimiter === "tab" ? "\t" : delimiter === "semicolon" ? ";" : ",";
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.map((f) => unquote(f));
}

function unquote(field: string): string {
  const t = field.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/""/g, '"').trim();
  }
  return t;
}

export function detectDelimiter(lines: string[]): ClassListDelimiter {
  const sample = lines.slice(0, 20);
  const count = (ch: string) => sample.reduce((n, l) => n + l.split(ch).length - 1, 0);
  if (count("\t") > 0) return "tab";
  if (count(";") > 0) return "semicolon";
  // "SURNAME, First M." names put stray single commas in space-aligned pastes,
  // so commas only count as a delimiter when no line is space-separated.
  const spaceSeparated = sample.filter((l) => l.trim().split(/\s{2,}/).length >= 2).length;
  const heavyCommas = sample.filter((l) => l.split(",").length - 1 >= 2).length;
  if (count(",") > 0 && (heavyCommas >= Math.ceil(sample.length / 2) || spaceSeparated === 0)) {
    return "comma";
  }
  if (spaceSeparated > 0) return "spaces";
  if (count(",") > 0) return "comma";
  return "spaces";
}

/**
 * Re-join "SURNAME, First M." that an unquoted comma paste split into two
 * fields. Runs only while a row is wider than expected, and prefers the pair
 * that looks most like a surname + given-names split.
 */
export function mergeSplitName(fields: string[], width: number): string[] {
  let out = [...fields];
  const nameish = /^[A-Za-zÑñ][A-Za-zÑñ.'\- ]*$/;
  while (out.length > width) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i]!.trim();
      const b = out[i + 1]!.trim();
      if (!a || !b || !nameish.test(a) || !nameish.test(b)) continue;
      // Never merge across a gender / year / id-like token.
      if (GENDER_VALUES.has(a.toLowerCase()) || GENDER_VALUES.has(b.toLowerCase())) continue;
      const score =
        (a === a.toUpperCase() ? 3 : 0) +
        (/^[A-ZÑ]/.test(a) ? 1 : 0) +
        (/^[A-ZÑ]/.test(b) ? 1 : 0) +
        (b.includes(" ") ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    out = [
      ...out.slice(0, best),
      `${out[best]!.trim()}, ${out[best + 1]!.trim()}`,
      ...out.slice(best + 2),
    ];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cell parsing                                                         */
/* ------------------------------------------------------------------ */

const GENDER_VALUES = new Set([
  "m",
  "f",
  "male",
  "female",
  "boy",
  "girl",
  "other",
  "others",
  "nonbinary",
]);

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
};

/**
 * Map a year / grade cell onto the unified `grade_level` scale:
 * Grade 7–12 stay as-is, college Year 1–4 become 13–16.
 */
export function parseGradeCell(raw: string): { value: number | null; note?: string } {
  const s = raw.trim().toLowerCase();
  if (!s) return { value: null };
  let n: number | null = null;
  const digits = s.match(/\d{1,4}/);
  if (digits) n = parseInt(digits[0], 10);
  else {
    const word = s.match(/\b(first|second|third|fourth|fifth|sixth)\b/);
    if (word) n = ORDINAL_WORDS[word[1]!] ?? null;
  }
  if (n == null || Number.isNaN(n))
    return { value: null, note: "Year not recognized — left blank" };
  if (n >= 7 && n <= 16) return { value: n };
  // "3rd Year" / "Year 3" / bare "3" can only mean college year in this LMS
  // (grade levels start at 7), except an explicit "grade 3" which is out of range.
  const saysGrade = /\b(gr|grd|grade)\b/.test(s.replace(/[.\s]/g, " "));
  if (!saysGrade && n >= 1 && n <= 4) return { value: 12 + n };
  return { value: null, note: "Year not recognized — left blank" };
}

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_ROLES: Array<[string[], ColumnRole]> = [
  [
    [
      "studentid",
      "studentno",
      "studentnumber",
      "id",
      "idno",
      "idnumber",
      "learnerid",
      "schoolid",
      "studentcode",
      "lrn",
      "indexno",
      "sid",
      "studentnum",
    ],
    "student_id",
  ],
  [["lastname", "surname", "familyname", "last"], "name_last"],
  [["firstname", "givenname", "first"], "name_first"],
  [["middlename", "middleinitial", "middleinitials", "middle", "mi"], "name_middle"],
  [["name", "fullname", "studentname", "learnername", "completename"], "full_name"],
  [["email", "emailaddress", "mail", "eaddress", "emailadd"], "email"],
  [
    [
      "year",
      "yearlevel",
      "grade",
      "gradelevel",
      "level",
      "yr",
      "gr",
      "glevel",
      "yearlvl",
      "gradelevel",
      "collegeyear",
      "yrlevel",
      "grd",
      "ylvl",
      "yearlevel",
    ],
    "grade",
  ],
  [
    [
      "section",
      "sectionblock",
      "block",
      "class",
      "sectionname",
      "program",
      "strand",
      "programstrand",
    ],
    "section",
  ],
  [["gender", "sex"], "gender"],
  [
    [
      "no",
      "number",
      "seq",
      "slno",
      "sl",
      "item",
      "count",
      "remarks",
      "notes",
      "note",
      "adviser",
      "advisor",
      "teacher",
      "contact",
      "phone",
      "mobile",
      "address",
      "birthdate",
      "age",
      "status",
      "nationality",
      "religion",
    ],
    "ignore",
  ],
];

function roleFromHeader(cell: string): ColumnRole | null {
  const key = normalizeHeader(cell);
  if (!key) return null;
  for (const [keys, role] of HEADER_ROLES) {
    if (keys.includes(key)) return role;
  }
  return null;
}

function isHeaderRow(fields: string[]): boolean {
  let hits = 0;
  for (const f of fields) {
    if (f && roleFromHeader(f)) hits++;
  }
  return hits >= 2 && hits >= Math.floor(fields.filter(Boolean).length / 2);
}

/* ------------------------------------------------------------------ */
/* Column inference (no header row)                                     */
/* ------------------------------------------------------------------ */

/**
 * When an unquoted "SURNAME, First M." name sits in every row, the comma split
 * turns ONE logical name column into two stable columns — so field counts look
 * perfectly consistent and nothing is "wider than expected". Detect the pair
 * (a surname-only column next to a given-names column, both mostly unique
 * text) and re-join them before anything else looks at the columns.
 */
export function findNameColumnPair(rows: string[][], width: number): number {
  const columns: string[][] = Array.from({ length: width }, () => []);
  for (const row of rows) {
    for (let c = 0; c < width; c++) {
      const v = (row[c] ?? "").trim();
      if (v) columns[c]!.push(v);
    }
  }
  const stats = columns.map((values) => {
    const sample = values.slice(0, 200);
    const n = sample.length;
    const letters = n ? sample.filter((v) => /[A-Za-zÑñ]/.test(v)).length / n : 0;
    const avgLen = n ? sample.reduce((s, v) => s + v.length, 0) / n : 0;
    const distinct = n ? new Set(sample.map((v) => v.toLowerCase())).size / n : 0;
    const multiToken = n ? sample.filter((v) => /[\s,]/.test(v)).length / n : 0;
    const capsSingle = n
      ? sample.filter((v) => !/\s/.test(v) && v === v.toUpperCase() && v.length >= 3).length / n
      : 0;
    const excluded =
      n === 0 ||
      sample.every((v) => GENDER_VALUES.has(v.toLowerCase())) ||
      sample.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) ||
      sample.every((v) => parseGradeCell(v).value != null) ||
      sample.filter((v) => /\d/.test(v) && /^[A-Za-z0-9][A-Za-z0-9.\-/]{2,24}$/.test(v)).length /
        n >=
        0.6;
    return { letters, avgLen, distinct, multiToken, capsSingle, excluded };
  });

  for (let c = 0; c + 1 < width; c++) {
    const a = stats[c]!;
    const b = stats[c + 1]!;
    if (a.excluded || b.excluded) continue;
    const nameish = (s: (typeof stats)[number]) =>
      s.letters >= 0.7 && s.avgLen >= 3 && s.distinct >= 0.5;
    if (!nameish(a) || !nameish(b)) continue;
    if (a.capsSingle >= 0.6 || b.multiToken >= 0.5) return c;
  }
  return -1;
}

/** Merge fields at `i` / `i+1` in every row into "A, B". */
export function mergeFieldPair(rows: string[][], i: number): string[][] {
  return rows.map((cells) => [
    ...cells.slice(0, i),
    `${(cells[i] ?? "").trim()}, ${(cells[i + 1] ?? "").trim()}`,
    ...cells.slice(i + 2),
  ]);
}

/**
 * Guess what each column holds when the paste has no header row. Content is
 * scored per column, then the best (column, role) pairs are picked greedily so
 * two columns can never both become the grade or the name. Columns class lists
 * always carry (student number first, name second) break ties.
 */
function inferRoles(rows: string[][], width: number): ColumnRole[] {
  const columns: string[][] = Array.from({ length: width }, () => []);
  for (const row of rows) {
    for (let c = 0; c < width; c++) {
      const v = (row[c] ?? "").trim();
      if (v) columns[c]!.push(v);
    }
  }

  const scored: Array<{ col: number; role: ColumnRole; score: number }> = [];
  columns.forEach((values, col) => {
    const sample = values.slice(0, 200);
    if (!sample.length) return;

    if (sample.every((v) => GENDER_VALUES.has(v.toLowerCase()))) {
      scored.push({ col, role: "gender", score: 100 });
    }
    if (sample.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) {
      scored.push({ col, role: "email", score: 100 });
    }
    const gradeRatio = sample.filter((v) => parseGradeCell(v).value != null).length / sample.length;
    // A plain 1..n run is a row counter, not a year level.
    const isCounter = sample.length >= 8 && sample.every((v, i) => parseInt(v, 10) === i + 1);
    if (gradeRatio === 1 && !isCounter) {
      scored.push({ col, role: "grade", score: 90 });
    }
    const digitish =
      sample.filter((v) => /\d/.test(v) && /^[A-Za-z0-9][A-Za-z0-9.\-/]{2,24}$/.test(v)).length /
      sample.length;
    if (digitish >= 0.6) {
      scored.push({ col, role: "student_id", score: 55 + digitish * 45 + (col === 0 ? 5 : 0) });
    }
    const letters = sample.filter((v) => /[A-Za-zÑñ]/.test(v)).length / sample.length;
    if (letters >= 0.6) {
      const avgLen = sample.reduce((n, v) => n + v.length, 0) / sample.length;
      const distinct = new Set(sample.map((v) => v.toLowerCase())).size;
      const looksLikeName = avgLen >= 8 || sample.some((v) => v.includes(" ") || v.includes(","));
      if (looksLikeName) {
        scored.push({
          col,
          role: "full_name",
          score: 65 + avgLen + (col === 1 ? 8 : 0),
        });
      }
      if (distinct <= Math.max(4, Math.ceil(sample.length / 3)) && avgLen <= 14) {
        scored.push({ col, role: "section", score: 50 });
      }
    }
  });

  scored.sort((a, b) => b.score - a.score || a.col - b.col);
  const roles: ColumnRole[] = Array.from({ length: width }, () => "ignore");
  const usedRoles = new Set<ColumnRole>();
  for (const s of scored) {
    if (roles[s.col] !== "ignore" || usedRoles.has(s.role)) continue;
    roles[s.col] = s.role;
    usedRoles.add(s.role);
  }

  // Last resort: an unclaimed first column is probably the student number and
  // the longest unclaimed column the name.
  if (!usedRoles.has("student_id")) {
    const c = roles.findIndex((r) => r === "ignore");
    if (c >= 0) roles[c] = "student_id";
  }
  if (!usedRoles.has("full_name")) {
    let bestC = -1;
    let bestLen = 0;
    columns.forEach((values, c) => {
      if (roles[c] !== "ignore" || !values.length) return;
      const avgLen = values.reduce((n, v) => n + v.length, 0) / values.length;
      if (avgLen > bestLen) {
        bestLen = avgLen;
        bestC = c;
      }
    });
    if (bestC >= 0) roles[bestC] = "full_name";
  }
  return roles;
}

/* ------------------------------------------------------------------ */
/* Row validation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Recompute errors + warnings for one row (also used by the review table when
 * a teacher edits a cell). Truncation and the blank-year note are derived
 * state, so they can safely run again after every edit.
 */
export function validateClassListRow(row: ClassListRow): ClassListRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  let { full_name, section } = row;
  const { student_id, email } = row;

  if (!full_name) errors.push("Missing a name");
  else if (full_name.length > 200) {
    full_name = full_name.slice(0, 200);
    warnings.push("Name shortened to fit");
  }
  if (!student_id && !email) errors.push("Needs a student number or email");
  if (student_id && student_id.length > 50) errors.push("Student number is too long");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("That email doesn't look right");
  }
  if (section && section.length > 50) {
    section = section.slice(0, 50);
    warnings.push("Section shortened to fit");
  }
  if (row.grade_level == null && row.grade_raw && parseGradeCell(row.grade_raw).value == null) {
    warnings.push("Year not recognized — left blank");
  }

  return { ...row, full_name, student_id, email, section, errors, warnings };
}

/* ------------------------------------------------------------------ */
/* Main parser                                                          */
/* ------------------------------------------------------------------ */

export function parseClassList(text: string): ClassListParse {
  const notes: string[] = [];
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = clean
    .split("\n")
    .map((l, i) => ({ text: l.trim(), line: i + 1 }))
    .filter((l) => l.text.length > 0);

  if (!lines.length) {
    return { rows: [], delimiter: "comma", hasHeader: false, columns: [], notes };
  }

  const delimiter = detectDelimiter(lines.map((l) => l.text));
  let fields = lines.map((l) => ({
    fields: splitFields(l.text, delimiter),
    line: l.line,
    raw: l.text,
  }));

  const hasHeader = isHeaderRow(fields[0]!.fields);
  let roles: ColumnRole[];

  if (hasHeader) {
    roles = fields[0]!.fields.map((f) => roleFromHeader(f) ?? "ignore");
    fields = fields.slice(1);
  } else {
    let width = mode(fields.map((f) => f.fields.length));
    let cells = fields.map((f) => f.fields);
    // Re-join "SURNAME, First" name columns a comma split tore in two — even
    // though the field counts look consistent, the name is one logical column.
    for (let pass = 0; pass < 3; pass++) {
      const pair = findNameColumnPair(cells, width);
      if (pair < 0) break;
      cells = mergeFieldPair(cells, pair);
      width -= 1;
    }
    cells = cells.map((c) => mergeSplitName(c, width));
    fields = fields.map((f, i) => ({ ...f, fields: cells[i] ?? [] }));
    roles = inferRoles(cells, width);
  }

  const width = roles.length;
  fields = fields.map((f) => ({
    ...f,
    fields: mergeSplitName(f.fields, width),
  }));

  const rows: ClassListRow[] = fields.map(({ fields: cells, line }) => {
    const get = (role: ColumnRole): string | null => {
      const i = roles.indexOf(role);
      if (i < 0) return null;
      const v = (cells[i] ?? "").trim();
      return v.length ? v : null;
    };

    // Name — either one column, or last + first + middle composed.
    let full_name = get("full_name");
    const last = get("name_last");
    const first = get("name_first");
    const middle = get("name_middle");
    if (!full_name && (last || first)) {
      const given = [first, middle].filter(Boolean).join(" ");
      full_name = last && given ? `${last}, ${given}` : last || given || null;
    }

    const grade_raw = get("grade");

    const row = validateClassListRow({
      line,
      student_id: get("student_id"),
      full_name,
      email: get("email"),
      grade_level: grade_raw ? parseGradeCell(grade_raw).value : null,
      grade_raw,
      section: get("section"),
      gender: get("gender"),
      errors: [],
      warnings: [],
    });
    if (cells.length > width) row.warnings.push("Row has extra columns — they were ignored");
    return row;
  });

  if (rows.some((r) => r.gender)) {
    notes.push(
      "A gender column was found — it helps match the columns, but isn't saved on student records.",
    );
  }
  if (!rows.some((r) => r.grade_level != null) && rows.length) {
    notes.push("No grade/year column detected — you can set the grade per row in the review.");
  }

  return { rows, delimiter, hasHeader, columns: roles, notes };
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? 1;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return Math.max(best, 1);
}

/* ------------------------------------------------------------------ */
/* Review annotation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Turn parsed rows into review rows: flag broken rows, later copies of the
 * same student within the paste, and matches against students already in the
 * system (by student number, then email) — including who is already enrolled
 * in the target course.
 */
export function reviewClassList(
  rows: ClassListRow[],
  opts: {
    existing?: Array<{
      id: string;
      student_id?: string | null;
      email?: string | null;
      full_name?: string;
    }>;
    enrolledIds?: Set<string>;
  } = {},
): ReviewRow[] {
  const existing = opts.existing ?? [];
  const enrolledIds = opts.enrolledIds ?? new Set<string>();
  const byStudentNo = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const s of existing) {
    if (s.student_id) byStudentNo.set(s.student_id.toLowerCase(), s.id);
    if (s.email) byEmail.set(s.email.toLowerCase(), s.id);
  }

  const seenNo = new Map<string, number>();
  const seenEmail = new Map<string, number>();

  return rows.map((row, i) => {
    const key = `row-${i}`;
    const no = row.student_id?.toLowerCase() ?? null;
    const mail = row.email?.toLowerCase() ?? null;

    const base = { ...row, key, include: true, match_id: null as string | null };

    if (row.errors.length) {
      return {
        ...base,
        include: false,
        status: "invalid" as const,
        note: row.errors.join(" · "),
      };
    }

    const firstNo = no ? seenNo.get(no) : undefined;
    const firstMail = mail ? seenEmail.get(mail) : undefined;
    if (firstNo != null || firstMail != null) {
      return {
        ...base,
        include: false,
        status: "duplicate" as const,
        note: `Same student as row ${(firstNo ?? firstMail ?? 0) + 1} — kept the first one`,
      };
    }
    if (no) seenNo.set(no, i);
    if (mail) seenEmail.set(mail, i);

    const matchId = (no && byStudentNo.get(no)) || (mail && byEmail.get(mail)) || null;
    if (matchId) {
      const already = enrolledIds.has(matchId);
      return {
        ...base,
        match_id: matchId,
        status: already ? ("already-enrolled" as const) : ("existing" as const),
        note: already
          ? "Already in this course — details stay as they are"
          : "Already in the system — will be enrolled and details refreshed",
      };
    }

    return {
      ...base,
      status: "new" as const,
      note: "New student",
    };
  });
}
