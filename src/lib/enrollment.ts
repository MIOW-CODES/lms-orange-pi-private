/**
 * Shared enrollment types + error copy used by both the server domain module and
 * the client RPC layer, so messages stay in sync and are easy to translate.
 */

/** Client-side shape for create-or-enroll (mirrors `schemas.studentEnroll`). */
export interface StudentEnrollInput {
  full_name: string;
  student_id?: string | null;
  email?: string | null;
  role?: "student" | "teacher" | "admin";
  grade_level?: number | null;
  section?: string | null;
  employee_id?: string | null;
  prefix?: string | null;
  department?: string | null;
  pin?: string | null;
  rfid_uid?: string | null;
  avatar_url?: string | null;
}

export const ENROLLMENT_ERRORS = {
  notFound: "Student not found",
  nonStudent: (role: string) => `That identity belongs to a ${role} account, not a student.`,
} as const;

/* ---------- Bulk roster import (bulk-add students) ---------- */

/** One row of a pasted class list, ready to create-or-enroll. */
export interface BulkStudentRow {
  full_name: string;
  student_id?: string | null;
  email?: string | null;
  grade_level?: number | null;
  section?: string | null;
  avatar_url?: string | null;
}

export type BulkRowStatus = "created" | "existing" | "failed";

export interface BulkAddRowOutcome {
  index: number;
  full_name: string;
  status: BulkRowStatus;
  /** Profile id for rows that were saved. */
  profile_id: string | null;
  error?: string;
}

export interface BulkAddResult {
  /** New student records created. */
  added: number;
  /** Existing students matched and linked (enrolled / refreshed). */
  linked: number;
  /** Students placed into the target course. */
  enrolled: number;
  /** Students appended to the target meeting, or null when none was chosen. */
  meeting_added: number | null;
  rows: BulkAddRowOutcome[];
}
