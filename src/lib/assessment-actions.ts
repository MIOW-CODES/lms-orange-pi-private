/**
 * Shared, pure assessment action-state helpers.
 *
 * Kept out of the route components so the "Start → Retake → View" decision can be
 * unit-tested — a first attempt must never render as "Retake".
 */

export interface WorksheetActionState {
  /** How many attempts the student has recorded for this worksheet. */
  attemptsUsed: number;
  /** Whether the retake policy still allows another attempt. */
  canRetake: boolean;
}

/** Primary action label for a worksheet row. */
export function worksheetActionLabel({
  attemptsUsed,
  canRetake,
}: WorksheetActionState): "Start" | "Retake" | "View" {
  if (attemptsUsed <= 0) return "Start";
  return canRetake ? "Retake" : "View";
}

/** Whether a worksheet can be opened for a new attempt. */
export function canAttemptWorksheet({ attemptsUsed, canRetake }: WorksheetActionState): boolean {
  return attemptsUsed <= 0 || canRetake;
}

export interface AssignmentActionState {
  /** Submission status, or undefined when the student has not submitted. */
  status?: "pending" | "submitted" | "graded" | undefined;
}

/** Primary action label for an assignment row. */
export function assignmentActionLabel({ status }: AssignmentActionState): "Submit" | "View" {
  return !status || status === "pending" ? "Submit" : "View";
}
