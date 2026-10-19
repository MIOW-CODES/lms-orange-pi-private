/**
 * Worksheet question types shared by the Create/Edit Worksheet form, the
 * ClassMate prompt builder, and the worksheet parser.
 *
 * Teachers pick which types to generate; the model is instructed to produce
 * ONLY those sections, and the parser tolerates any subset (0..N).
 */

export const WORKSHEET_QUESTION_TYPES = ["mc", "fill", "matching", "essay"] as const;

export type WorksheetQuestionType = (typeof WORKSHEET_QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<WorksheetQuestionType, string> = {
  mc: "Multiple Choice",
  fill: "Fill in the Blank",
  matching: "Matching Type",
  essay: "Essay / Short Answer",
};

/** Default selection when a teacher hasn't chosen yet. */
export const DEFAULT_QUESTION_TYPES: WorksheetQuestionType[] = ["mc", "fill"];

export function isWorksheetQuestionType(value: unknown): value is WorksheetQuestionType {
  return (
    typeof value === "string" && (WORKSHEET_QUESTION_TYPES as readonly string[]).includes(value)
  );
}

/** Coerce an arbitrary array into a de-duplicated, valid, ordered type list. */
export function normalizeQuestionTypes(
  values: readonly unknown[] | undefined | null,
): WorksheetQuestionType[] {
  if (!values) return [];
  const seen = new Set<WorksheetQuestionType>();
  for (const v of values) {
    if (isWorksheetQuestionType(v)) seen.add(v);
  }
  // Preserve the canonical order regardless of input order.
  return WORKSHEET_QUESTION_TYPES.filter((t) => seen.has(t));
}

/** Human-readable list, e.g. "Multiple Choice and Fill in the Blank". */
export function formatQuestionTypes(types: readonly WorksheetQuestionType[]): string {
  const labels = types.map((t) => QUESTION_TYPE_LABELS[t]);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}
