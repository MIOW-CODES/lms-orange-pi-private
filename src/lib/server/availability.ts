// Availability windows for assessments (quizzes/worksheets + assignments) and
// the materials-for-review policy (user-signed decisions, 2026-10-06).
//
// WHY PURE TYPESCRIPT: the pg compat layer (src/integrations/db/client.server.ts)
// can only express eq/gte/ilike/is/in filters — it cannot express the required
// `opens_at IS NULL OR opens_at <= now()` predicate. Rows are therefore fetched
// unfiltered and gated here in TypeScript after the fetch. Do NOT extend the
// compat layer (Gate-1 amendment #1); this module is also the seam for future
// auth centralization (C13).
//
// POLICIES:
//  * DEADLINES HARD-BLOCK EVERYTHING — attempts and submissions are rejected
//    before `opens_at` and after the deadline (quizzes: `closes_at`; assignments:
//    `due_date` and/or `closes_at` — the earliest configured deadline wins).
//    No late flag, no overwrite.
//  * MATERIALS FOR REVIEW — enrolled students download course materials once
//    ANY referencing assessment has opened (null opens_at = always) and RETAIN
//    access afterward. No attempt-gating, no re-locking.
//
// BOUNDARY SEMANTICS: a window is open while `opens_at <= now <= deadline`
// (inclusive on both ends). "Closed" means the deadline has *passed* — a submit
// exactly at the deadline is accepted, one second later is hard-blocked.

import type { ProfileRole } from "@/lib/server/db-types";

/** Minimum shape of a fetched assessment row for availability decisions. */
export interface AvailabilityRow {
  opens_at?: string | Date | null;
  closes_at?: string | Date | null;
  /** Assignments also hard-block at their due date. */
  due_date?: string | Date | null;
}

export type AvailabilityStatus = "not_yet_open" | "open" | "closed";

export type AvailabilityReason = "not_yet_open" | "closed";

/** Typed rejection thrown by {@link requireOpen} at enforcement points. */
export class AvailabilityError extends Error {
  readonly reason: AvailabilityReason;

  constructor(reason: AvailabilityReason) {
    super(
      reason === "not_yet_open"
        ? "This item is not open yet."
        : "The deadline for this item has passed.",
    );
    this.name = "AvailabilityError";
    this.reason = reason;
  }
}

function toMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * `opens_at IS NULL OR opens_at <= now` — a NULL opens_at means "open now"
 * (backward compat with every pre-existing row).
 */
export function hasOpened(row: AvailabilityRow, now: Date): boolean {
  const opensAtMs = toMs(row.opens_at);
  return opensAtMs == null || opensAtMs <= now.getTime();
}

/**
 * Earliest configured deadline (closes_at and/or due_date), as a millisecond
 * timestamp. NULL = no hard close.
 */
export function deadlineOf(row: AvailabilityRow): number | null {
  const candidates = [toMs(row.closes_at), toMs(row.due_date)].filter(
    (v): v is number => v != null,
  );
  return candidates.length ? Math.min(...candidates) : null;
}

/** True once the deadline has strictly passed (exactly at = still open). */
export function hasClosed(row: AvailabilityRow, now: Date): boolean {
  const deadlineMs = deadlineOf(row);
  return deadlineMs != null && now.getTime() > deadlineMs;
}

export function availabilityStatus(row: AvailabilityRow, now: Date): AvailabilityStatus {
  if (!hasOpened(row, now)) return "not_yet_open";
  if (hasClosed(row, now)) return "closed";
  return "open";
}

/**
 * Staff editability: a worksheet is protected ONLY while it has an explicit
 * schedule (non-null opens_at) whose window is currently open. Legacy rows with
 * opens_at NULL (always-open seeds) are never locked, so ordinary editing is
 * unaffected.
 */
export function isAssessmentEditable(row: AvailabilityRow, now: Date): boolean {
  const scheduled = toMs(row.opens_at) != null;
  return !scheduled || availabilityStatus(row, now) !== "open";
}

/**
 * Hard-block guard for attempt/submission write paths: throws
 * {@link AvailabilityError} unless the item is currently open. Staff callers
 * bypass at the call sites (grading/preview).
 */
export function requireOpen(row: AvailabilityRow, now: Date): void {
  const status = availabilityStatus(row, now);
  if (status !== "open") throw new AvailabilityError(status);
}

/**
 * List/preview visibility (Gate-1 amendment #3): staff see everything; students
 * never see items before they open, but closed items stay visible for review.
 */
export function canViewAssessment(row: AvailabilityRow, role: ProfileRole, now: Date): boolean {
  return true;
}

/** Course content scoping: staff always; students only when enrolled. */
export function canAccessCourse(role: ProfileRole, isEnrolled: boolean): boolean {
  return role !== "student" || isEnrolled;
}

/**
 * Materials-for-review ("any-open wins"): a file referenced by one or more
 * assessments is downloadable once ANY referencing assessment has opened, and
 * STAYS downloadable afterward (including after the deadline). Files not
 * referenced by any assessment are course-level and open immediately.
 */
export function isMaterialOpen(referencing: AvailabilityRow[], now: Date): boolean {
  return referencing.length === 0 || referencing.some((row) => hasOpened(row, now));
}
