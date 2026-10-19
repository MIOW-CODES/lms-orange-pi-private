// Question-bank worksheet grouping — shared pure helpers.
//
// The bank groups questions by worksheet. Ordering must be predictable so the
// summary chips and the table group headers always agree: course worksheet
// order (created_at, then title for same-instant seeds), exam-type worksheets
// last, and archived (soft-deleted) worksheets after every live one.

export interface WorksheetOrderInput {
  title: string;
  archived: boolean;
  created_at?: string | null;
}

/** Exam-type worksheets ("1st Quarter Exam", "Prelim Examination", …). */
export function isExamWorksheetTitle(title: string): boolean {
  return /\bexam(ination)?\b/i.test(title);
}

/**
 * Ordering rank: live worksheets first (0), then live exams (1), then
 * archived worksheets (2), then archived exams (3). Within a rank the
 * worksheets run in course order (created_at, tie-broken by title).
 */
export function worksheetRank(w: WorksheetOrderInput): number {
  return (w.archived ? 2 : 0) + (isExamWorksheetTitle(w.title) ? 1 : 0);
}

/** Stable, locale-independent comparator for worksheet groups/chips. */
export function compareWorksheetOrder(a: WorksheetOrderInput, b: WorksheetOrderInput): number {
  const rank = worksheetRank(a) - worksheetRank(b);
  if (rank !== 0) return rank;
  const created = Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? "");
  if (Number.isFinite(created) && created !== 0) return created;
  return a.title.localeCompare(b.title, "en");
}
