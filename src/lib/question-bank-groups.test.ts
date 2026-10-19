import { describe, it, expect } from "bun:test";
import {
  isExamWorksheetTitle,
  worksheetRank,
  compareWorksheetOrder,
  type WorksheetOrderInput,
} from "./question-bank-groups";

const w = (
  title: string,
  opts: { archived?: boolean; created_at?: string | null } = {},
): WorksheetOrderInput => ({
  title,
  archived: opts.archived ?? false,
  created_at: opts.created_at,
});

describe("question-bank worksheet ordering", () => {
  it("detects exam-type worksheets", () => {
    expect(isExamWorksheetTitle("1st Quarter Exam")).toBe(true);
    expect(isExamWorksheetTitle("PRELIM EXAMINATION (Coverage: Weeks 1-7)")).toBe(true);
    expect(isExamWorksheetTitle("Quiz — Arduino Part 1")).toBe(false);
    expect(isExamWorksheetTitle("Example worksheet")).toBe(false);
  });

  it("ranks live worksheets, then live exams, then archived, then archived exams", () => {
    expect(worksheetRank(w("Quiz — Arduino Part 1"))).toBe(0);
    expect(worksheetRank(w("1st Quarter Exam"))).toBe(1);
    expect(worksheetRank(w("Quiz — Lab Activity 1", { archived: true }))).toBe(2);
    expect(worksheetRank(w("Old Exam", { archived: true }))).toBe(3);
  });

  it("orders by rank first — exams last, archived last", () => {
    const items = [
      w("1st Quarter Exam", { created_at: "2026-10-08T23:12:20Z" }),
      w("Quiz — Arduino Part 1", { archived: true, created_at: "2026-10-09T00:07:56Z" }),
      w("Quiz — Resistor Color Code", { created_at: "2026-10-08T23:57:24Z" }),
      w("Quiz — Arduino Part 2", { created_at: "2026-10-08T23:57:24Z" }),
    ];
    const sorted = [...items].sort(compareWorksheetOrder).map((i) => i.title);
    expect(sorted).toEqual([
      "Quiz — Arduino Part 2",
      "Quiz — Resistor Color Code",
      "1st Quarter Exam",
      "Quiz — Arduino Part 1",
    ]);
  });

  it("orders same-rank worksheets by created_at then title (stable for batch seeds)", () => {
    const a = w("Quiz — B", { created_at: "2026-10-08T23:57:24.526939Z" });
    const b = w("Quiz — A", { created_at: "2026-10-08T23:57:24.526939Z" });
    const c = w("Quiz — C", { created_at: "2026-10-08T22:00:00Z" });
    expect([a, b, c].sort(compareWorksheetOrder).map((i) => i.title)).toEqual([
      "Quiz — C",
      "Quiz — A",
      "Quiz — B",
    ]);
  });

  it("falls back to title ordering when created_at is missing or unparseable", () => {
    const a = w("Quiz — Zulu", { created_at: null });
    const b = w("Quiz — Alpha", { created_at: "not-a-date" });
    expect([a, b].sort(compareWorksheetOrder).map((i) => i.title)).toEqual([
      "Quiz — Alpha",
      "Quiz — Zulu",
    ]);
  });
});
