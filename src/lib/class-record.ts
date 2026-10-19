/** Shared class-record arithmetic. No database, React, or RPC dependencies. */
export type RecordCategory = "ww" | "ex" | "pt";
export type RecordScale = "deped" | "college";
export type SessionStatus = "present" | "late" | "excused" | "absent";
export interface RecordColumn {
  id: string;
  title: string;
  category: RecordCategory;
  maximum: number;
  source?: { kind: "quiz" | "assignment"; id: string } | undefined;
}
export interface RecordScore {
  value: number;
  reason?: string | undefined;
  by?: string | undefined;
  at?: string | undefined;
}
export interface RecordSession {
  id: string;
  date: string;
  cancelled: boolean;
  marks: Record<string, SessionStatus>;
}
export interface RecordDraft {
  start: string;
  end: string;
  columns: RecordColumn[];
  scores: Record<string, Record<string, RecordScore>>;
  attendance: Record<string, RecordScore>;
  sessions: RecordSession[];
}
export interface RecordSource {
  id: string;
  kind: "quiz" | "assignment";
  title: string;
  maximum: number;
  scores: Record<string, { score: number; total: number }>;
}
export interface RecordSnapshot {
  version: 1;
  scale: RecordScale;
  attendance: number;
  ww: number;
  ex: number;
  pt: number;
  contributions: { attendance: number; ww: number; ex: number; pt: number };
  initial: number;
  final: number;
  remarks: string;
  publishedAt: string;
  publishedBy: string;
}
export const emptyRecord = (): RecordDraft => ({
  start: "",
  end: "",
  columns: [],
  scores: {},
  attendance: {},
  sessions: [],
});
export const recordWeights = { attendance: 0.1, ww: 0.2, ex: 0.3, pt: 0.4 } as const;
const collegeBands = [
  [96, 1, "Excellent"],
  [92, 1.25, "Excellent"],
  [88, 1.5, "Very good"],
  [84, 1.75, "Very good"],
  [79, 2, "Good"],
  [74, 2.25, "Good"],
  [69, 2.5, "Satisfactory"],
  [64, 2.75, "Satisfactory"],
  [59, 3, "Passing"],
  [53, 3.25, "Incomplete"],
  [42, 3.5, "Incomplete"],
  [31, 3.75, "Incomplete"],
  [20, 4, "Failed"],
  [0, 5, "Failed"],
] as const;
export function collegeGrade(initial: number) {
  const band =
    collegeBands.find(([minimum]) => initial >= minimum) ?? collegeBands[collegeBands.length - 1]!;
  return { final: band[1], remarks: band[2] };
}
// Equivalent to the incumbent DepEd table, including its lower-end bands.
export function depedGrade(initial: number) {
  if (initial >= 100) return 100;
  if (initial >= 60) return Math.min(99, 75 + Math.floor((initial - 60 + 1e-9) / 1.6));
  return Math.max(60, 60 + Math.floor((initial + 1e-9) / 4));
}
export function depedRemarks(final: number) {
  return final >= 90
    ? "Outstanding"
    : final >= 85
      ? "Very Satisfactory"
      : final >= 80
        ? "Satisfactory"
        : final >= 75
          ? "Fairly Satisfactory"
          : "Did Not Meet Expectations";
}
export function scaleForCourse(course: {
  education_level?: string | null;
  grade_level: number;
  grading_system?: string | null;
}): RecordScale {
  return course.education_level === "college" || course.grade_level >= 13 ? "college" : "deped";
}
export function recordCell(
  draft: RecordDraft,
  sources: RecordSource[],
  studentId: string,
  col: RecordColumn,
): number | null {
  const manual = draft.scores[studentId]?.[col.id];
  if (manual) return manual.value;
  if (!col.source) return null;
  const source = sources.find((s) => s.id === col.source!.id && s.kind === col.source!.kind);
  const value = source?.scores[studentId];
  // Normalize each student's actual attempt denominator, never a classmate's total.
  return value &&
    Number.isFinite(value.score) &&
    Number.isFinite(value.total) &&
    value.total > 0 &&
    value.score >= 0 &&
    value.score <= value.total
    ? (value.score / value.total) * col.maximum
    : null;
}
export function recordAttendance(draft: RecordDraft, studentId: string): number | null {
  if (draft.attendance[studentId]) return draft.attendance[studentId]!.value;
  if (!draft.start || !draft.end) return null;
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sessions = draft.sessions.filter(
    (s) => !s.cancelled && s.date >= draft.start && s.date <= draft.end && s.date <= today,
  );
  if (!sessions.length || sessions.some((s) => !s.marks[studentId])) return null;
  return (
    sessions.reduce(
      (sum, s) =>
        sum + (s.marks[studentId] === "absent" ? 0 : s.marks[studentId] === "late" ? 85 : 100),
      0,
    ) / sessions.length
  );
}
export function calculateRecord(
  draft: RecordDraft,
  sources: RecordSource[],
  studentId: string,
  scale: RecordScale,
) {
  const missing: string[] = [];
  const attendance = recordAttendance(draft, studentId);
  if (attendance == null) missing.push("Attendance");
  const categories = {} as Record<
    RecordCategory,
    { earned: number; possible: number; percent: number | null }
  >;
  for (const category of ["ww", "ex", "pt"] as const) {
    const cols = draft.columns.filter((c) => c.category === category);
    let earned = 0;
    const possible = cols.reduce((sum, col) => sum + col.maximum, 0);
    if (!cols.length)
      missing.push(
        category === "ww"
          ? "Written Works"
          : category === "ex"
            ? "Examination"
            : "Performance Tasks",
      );
    for (const col of cols) {
      const score = recordCell(draft, sources, studentId, col);
      if (score == null) missing.push(col.title);
      else earned += score;
    }
    categories[category] = {
      earned,
      possible,
      percent: possible > 0 ? (earned / possible) * 100 : null,
    };
  }
  const contributions = {
    attendance: (attendance ?? 0) * 0.1,
    ww: (categories.ww.percent ?? 0) * 0.2,
    ex: (categories.ex.percent ?? 0) * 0.3,
    pt: (categories.pt.percent ?? 0) * 0.4,
  };
  const initial = Object.values(contributions).reduce((sum, n) => sum + n, 0);
  const final = scale === "college" ? collegeGrade(initial).final : depedGrade(initial);
  const remarks = scale === "college" ? collegeGrade(initial).remarks : depedRemarks(final);
  return {
    attendance,
    categories,
    contributions,
    initial,
    final,
    remarks,
    missing,
    complete: missing.length === 0,
  };
}
