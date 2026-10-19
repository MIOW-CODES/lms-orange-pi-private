import { describe, expect, it } from "bun:test";
import {
  calculateRecord,
  collegeGrade,
  depedGrade,
  emptyRecord,
  recordAttendance,
  recordCell,
  scaleForCourse,
  type RecordDraft,
} from "./class-record";
import { previewRecordImport, recordSheetRows } from "./class-record-spreadsheet";
import { matchesIdentification, matchesOption } from "./answer-matching";
import * as XLSX from "xlsx";
const sid = "11111111-1111-4111-8111-111111111111";
const student = { id: sid, student_id: "S001", full_name: "Student, One", section: "Omega" };
function fixture(): RecordDraft {
  return {
    ...emptyRecord(),
    columns: [
      { id: crypto.randomUUID(), title: "Q1", category: "ww", maximum: 20 },
      { id: crypto.randomUUID(), title: "Q2", category: "ww", maximum: 80 },
      { id: crypto.randomUUID(), title: "Exam", category: "ex", maximum: 50 },
      { id: crypto.randomUUID(), title: "PT1", category: "pt", maximum: 40 },
    ],
  };
}
function full() {
  const d = fixture();
  d.attendance[sid] = { value: 100, reason: "Class attendance" };
  d.scores[sid] = Object.fromEntries(d.columns.map((c) => [c.id, { value: c.maximum }]));
  return d;
}
describe("class record arithmetic", () => {
  it("uses point totals rather than an average of quiz percentages", () => {
    const d = full();
    d.scores[sid]![d.columns[0]!.id] = { value: 0 };
    const r = calculateRecord(d, [], sid, "deped");
    expect(r.categories.ww.percent).toBe(80);
    expect(r.initial).toBe(96);
    expect(r.complete).toBe(true);
  });
  it("distinguishes blank from an explicit zero and retains full denominators", () => {
    const d = full();
    delete d.scores[sid]![d.columns[0]!.id];
    const r = calculateRecord(d, [], sid, "deped");
    expect(r.complete).toBe(false);
    expect(r.missing).toContain("Q1");
    expect(r.categories.ww.possible).toBe(100);
    d.scores[sid]![d.columns[0]!.id] = { value: 0 };
    expect(calculateRecord(d, [], sid, "deped").complete).toBe(true);
  });
  it("does not renormalize absent categories", () => {
    const d = emptyRecord();
    d.attendance[sid] = { value: 100 };
    const r = calculateRecord(d, [], sid, "deped");
    expect(r.initial).toBe(10);
    expect(r.complete).toBe(false);
  });
  it("normalizes an effective attempt with a different total and honors manual overrides", () => {
    const d = fixture();
    const q = d.columns[0]!;
    q.source = { kind: "quiz", id: crypto.randomUUID() };
    const sources = [
      { ...q.source, title: "Q1", maximum: 20, scores: { [sid]: { score: 9, total: 10 } } },
    ];
    expect(recordCell(d, sources, sid, q)).toBe(18);
    d.scores[sid] = { [q.id]: { value: 0, reason: "Missed work" } };
    expect(recordCell(d, sources, sid, q)).toBe(0);
  });
  it("does not divide by zero on an invalid automatic score", () => {
    const d = fixture();
    const q = d.columns[0]!;
    q.source = { kind: "quiz", id: crypto.randomUUID() };
    expect(
      recordCell(
        d,
        [{ ...q.source, title: "Q1", maximum: 20, scores: { [sid]: { score: 0, total: 0 } } }],
        sid,
        q,
      ),
    ).toBe(null);
  });
  it("uses college metadata with the established grade-level fallback", () => {
    expect(scaleForCourse({ grade_level: 10 })).toBe("deped");
    expect(scaleForCourse({ grade_level: 14 })).toBe("college");
  });
  it("preserves DepEd boundary behavior", () => {
    expect(depedGrade(60)).toBe(75);
    expect(depedGrade(61.59)).toBe(75);
    expect(depedGrade(61.6)).toBe(76);
    expect(depedGrade(98.4)).toBe(99);
    expect(depedGrade(100)).toBe(100);
    expect(depedGrade(56)).toBe(74);
  });
  it("uses workbook college bands without rounding across a boundary", () => {
    for (const [min, grade] of [
      [0, 5],
      [20, 4],
      [31, 3.75],
      [42, 3.5],
      [53, 3.25],
      [59, 3],
      [64, 2.75],
      [69, 2.5],
      [74, 2.25],
      [79, 2],
      [84, 1.75],
      [88, 1.5],
      [92, 1.25],
      [96, 1],
    ])
      expect(collegeGrade(min!).final).toBe(grade);
    expect(collegeGrade(95.999).final).toBe(1.25);
  });
});
describe("class attendance", () => {
  it("limits sessions to the period and excludes cancelled sessions", () => {
    const d = emptyRecord();
    d.start = "2026-10-01";
    d.end = "2026-10-31";
    d.sessions = [
      { id: "a", date: "2026-09-30", cancelled: false, marks: { [sid]: "absent" } },
      { id: "b", date: "2026-10-02", cancelled: false, marks: { [sid]: "late" } },
      { id: "c", date: "2026-10-03", cancelled: false, marks: { [sid]: "excused" } },
      { id: "d", date: "2026-10-04", cancelled: true, marks: {} },
    ];
    expect(recordAttendance(d, sid)).toBe(92.5);
    d.sessions.push({ id: "e", date: "2026-10-05", cancelled: false, marks: {} });
    expect(recordAttendance(d, sid)).toBe(null);
    d.attendance[sid] = { value: 0, reason: "Teacher verified absence" };
    expect(recordAttendance(d, sid)).toBe(0);
  });
});
describe("class-record spreadsheets", () => {
  it("round-trips exported assessment scores and maxima without importing computed totals", () => {
    const d = full();
    const rows = recordSheetRows(d, [], [student], "deped").rows;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Record");
    const result = previewRecordImport(wb, "Record", emptyRecord(), [student], "record.xlsx");
    expect(result.errors).toEqual([]);
    expect(result.matched).toBe(1);
    expect(result.draft.columns).toHaveLength(4);
    expect(calculateRecord(result.draft, [], sid, "deped").initial).toBe(100);
  });
  it("parses the supplied worksheet layout with raw scores and ignores its old weights", () => {
    // Reproduce the supplied layout with synthetic data; never commit student records.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["University"],
        ["College"],
        ["Class List"],
        ["IAE106"],
        ["School Year"],
        [
          "No",
          "NAME",
          "WRITTEN WORKS (25%)",
          null,
          null,
          "PERFORMANCE TASK (25%)",
          null,
          null,
          "QUARTERLY ASSESSMENT (50%)",
          null,
          "PERCENTAGE",
        ],
        [
          null,
          null,
          "WW1",
          "WW2",
          "TOTAL",
          "PT1",
          "PT2",
          "TOTAL",
          "QA",
          "TOTAL",
          "WW",
          "PT",
          "QA",
          "TOTAL",
        ],
        [null, null, 40, 20, 60, 11, 80, 91, 40, 40, 0.25, 0.25, 0.5, 1],
        [1, "Student, One", 13, 20, 33, 10, 60, 70, 28, 28, 13.75, 19.23, 35, 67.98],
      ]),
      "IAE 106",
    );
    const result = previewRecordImport(wb, "IAE 106", emptyRecord(), [student], "reference.xlsx");
    expect(result.errors).toEqual([]);
    expect(result.matched).toBe(1);
    expect(result.draft.columns).toHaveLength(5);
    const r = calculateRecord(result.draft, [], sid, "college");
    expect(r.categories.ww.percent).toBeCloseTo(55, 10);
    expect(r.categories.pt.possible).toBe(91);
    expect(r.missing).toEqual(["Attendance"]);
  });
  it("rejects duplicate or ambiguous names and invalid points", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Student No", "Name", "Q1"],
        ["", "Maximum", 20],
        ["S001", "Student, One", 21],
        ["S001", "Student, One", 5],
      ]),
      "Record",
    );
    const r = previewRecordImport(wb, "Record", emptyRecord(), [student], "x.xlsx");
    expect(r.errors).toHaveLength(2);
  });
});
describe("conservative identification matching", () => {
  it("accepts Unicode formatting, whitespace and explicit aliases", () => {
    expect(matchesIdentification("  ＤｉｇｉｔａｌRead()  ", "digitalRead||digitalRead()")).toBe(
      true,
    );
    expect(matchesIdentification("LIGHT LEVEL.", "light||light level")).toBe(true);
  });
  it("does not accept substring guesses or change MCQ semantics", () => {
    expect(matchesIdentification("Arduino IDE", "arduino")).toBe(false);
    expect(matchesIdentification("digital screen", "lcd")).toBe(false);
    expect(matchesOption("not HIGH", "HIGH")).toBe(false);
    expect(matchesIdentification("", "arduino")).toBe(false);
  });
});
