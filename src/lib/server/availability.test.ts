import { describe, it, expect } from "bun:test";

import {
  hasOpened,
  hasClosed,
  deadlineOf,
  availabilityStatus,
  isAssessmentEditable,
  requireOpen,
  AvailabilityError,
  canViewAssessment,
  canAccessCourse,
  isMaterialOpen,
} from "./availability";

// Fixed clock for deterministic boundaries.
const NOW = new Date("2026-10-06T12:00:00.000Z");
const SEC = 1000;
const MIN = 60_000;

/** ISO timestamp `offsetMs` away from NOW (negative = past). */
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

/* ---------- hasOpened — truth table (null / ± now) ---------- */

describe("hasOpened (opens_at IS NULL OR opens_at <= now)", () => {
  it("is open when opens_at is absent (backward compat)", () => {
    expect(hasOpened({}, NOW)).toBe(true);
    expect(hasOpened({ opens_at: null }, NOW)).toBe(true);
    expect(hasOpened({ opens_at: undefined }, NOW)).toBe(true);
  });

  it("is open when opens_at is in the past", () => {
    expect(hasOpened({ opens_at: at(-MIN) }, NOW)).toBe(true);
  });

  it("is open exactly at opens_at (inclusive boundary)", () => {
    expect(hasOpened({ opens_at: at(0) }, NOW)).toBe(true);
  });

  it("is NOT open when opens_at is in the future", () => {
    expect(hasOpened({ opens_at: at(+MIN) }, NOW)).toBe(false);
    expect(hasOpened({ opens_at: at(+1) }, NOW)).toBe(false);
  });

  it("accepts Date values as well as ISO strings", () => {
    expect(hasOpened({ opens_at: new Date(NOW.getTime() - MIN) }, NOW)).toBe(true);
    expect(hasOpened({ opens_at: new Date(NOW.getTime() + MIN) }, NOW)).toBe(false);
  });
});

/* ---------- hasClosed / deadlineOf — hard-block boundary ---------- */

describe("hasClosed (deadline passed?)", () => {
  it("is never closed without a configured deadline", () => {
    expect(hasClosed({}, NOW)).toBe(false);
    expect(hasClosed({ closes_at: null, due_date: null }, NOW)).toBe(false);
    expect(deadlineOf({})).toBeNull();
  });

  it("closes after quizzes' closes_at passes", () => {
    expect(hasClosed({ closes_at: at(-MIN) }, NOW)).toBe(true);
    expect(hasClosed({ closes_at: at(+MIN) }, NOW)).toBe(false);
  });

  it("closes after assignments' due_date passes", () => {
    expect(hasClosed({ due_date: at(-MIN) }, NOW)).toBe(true);
    expect(hasClosed({ due_date: at(+MIN) }, NOW)).toBe(false);
  });

  it("accepts a submission exactly at the deadline and rejects 1 second after", () => {
    const row = { closes_at: at(0) };
    expect(hasClosed(row, NOW)).toBe(false); // exactly at due → still accepted
    expect(requireOpen.bind(null, row, NOW)).not.toThrow();
    expect(hasClosed(row, new Date(NOW.getTime() + SEC))).toBe(true); // +1s → hard-blocked
    expect(hasClosed(row, new Date(NOW.getTime() - SEC))).toBe(false); // -1s → accepted
  });

  it("uses the EARLIEST configured deadline when both are set", () => {
    expect(deadlineOf({ closes_at: at(+MIN), due_date: at(-MIN) })).toBe(NOW.getTime() - MIN);
    expect(deadlineOf({ closes_at: at(-MIN), due_date: at(+MIN) })).toBe(NOW.getTime() - MIN);
    // Either deadline passing closes the item (no late work past due_date).
    expect(hasClosed({ closes_at: at(+MIN), due_date: at(-MIN) }, NOW)).toBe(true);
    expect(hasClosed({ closes_at: at(-MIN), due_date: at(+MIN) }, NOW)).toBe(true);
    expect(hasClosed({ closes_at: at(+MIN), due_date: at(+MIN) }, NOW)).toBe(false);
  });
});

/* ---------- requireOpen — the hard-block guard ---------- */

describe("requireOpen", () => {
  it("passes inside the window (null fields = always open)", () => {
    expect(() => requireOpen({}, NOW)).not.toThrow();
    expect(() => requireOpen({ opens_at: at(-MIN), closes_at: at(+MIN) }, NOW)).not.toThrow();
  });

  it("rejects BEFORE opens_at with reason not_yet_open", () => {
    try {
      requireOpen({ opens_at: at(+MIN) }, NOW);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AvailabilityError);
      expect((e as AvailabilityError).reason).toBe("not_yet_open");
    }
  });

  it("rejects AFTER the deadline with reason closed (no late flag)", () => {
    try {
      requireOpen({ closes_at: at(-SEC) }, NOW);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AvailabilityError);
      expect((e as AvailabilityError).reason).toBe("closed");
    }
    expect(() => requireOpen({ due_date: at(-SEC) }, NOW)).toThrow(AvailabilityError);
  });

  it("hard-blocks at the boundary: exactly at due = accepted, 1s after = rejected", () => {
    const row = { due_date: at(0) };
    expect(() => requireOpen(row, NOW)).not.toThrow();
    expect(() => requireOpen(row, new Date(NOW.getTime() + SEC))).toThrow(AvailabilityError);
  });

  it("exposes the window state via availabilityStatus", () => {
    expect(availabilityStatus({ opens_at: at(+MIN) }, NOW)).toBe("not_yet_open");
    expect(availabilityStatus({}, NOW)).toBe("open");
    expect(availabilityStatus({ closes_at: at(-1) }, NOW)).toBe("closed");
  });
});

/* ---------- isAssessmentEditable — staff edit lock during open windows ---------- */

describe("isAssessmentEditable (staff edit lock)", () => {
  it("legacy always-open rows (opens_at NULL) are NEVER locked", () => {
    expect(isAssessmentEditable({}, NOW)).toBe(true);
    expect(isAssessmentEditable({ opens_at: null }, NOW)).toBe(true);
    expect(isAssessmentEditable({ opens_at: undefined }, NOW)).toBe(true);
  });

  it("a scheduled window that has not opened yet is editable", () => {
    expect(isAssessmentEditable({ opens_at: at(+MIN), closes_at: at(+2 * MIN) }, NOW)).toBe(true);
  });

  it("locks while the scheduled window is open (opens_at past, closes_at future)", () => {
    expect(isAssessmentEditable({ opens_at: at(-MIN), closes_at: at(+MIN) }, NOW)).toBe(false);
  });

  it("locks exactly AT opens_at (inclusive lower boundary)", () => {
    expect(isAssessmentEditable({ opens_at: at(0), closes_at: at(+MIN) }, NOW)).toBe(false);
  });

  it("still locks exactly AT closes_at (window is still open there)", () => {
    expect(isAssessmentEditable({ opens_at: at(-MIN), closes_at: at(0) }, NOW)).toBe(false);
  });

  it("unlocks once the window has closed (after closes_at)", () => {
    expect(isAssessmentEditable({ opens_at: at(-MIN), closes_at: at(-SEC) }, NOW)).toBe(true);
    const row = { opens_at: at(-2 * MIN), closes_at: at(0) };
    expect(isAssessmentEditable(row, NOW)).toBe(false); // at closes_at → still locked
    expect(isAssessmentEditable(row, new Date(NOW.getTime() + SEC))).toBe(true); // +1s → editable
  });

  it("locks scheduled rows with no closes_at (open-ended exam in progress)", () => {
    expect(isAssessmentEditable({ opens_at: at(-MIN) }, NOW)).toBe(false);
    expect(isAssessmentEditable({ opens_at: at(-MIN), closes_at: null }, NOW)).toBe(false);
  });
});

/* ---------- isMaterialOpen — "any-open wins" materials-for-review ---------- */

describe("isMaterialOpen (materials for review)", () => {
  it("opens course-level files immediately when no assessment references them", () => {
    expect(isMaterialOpen([], NOW)).toBe(true);
  });

  it("hides a file while EVERY referencing assessment is still unopened", () => {
    expect(isMaterialOpen([{ opens_at: at(+MIN) }, { opens_at: at(+2 * MIN) }], NOW)).toBe(false);
  });

  it("any-open wins: one opened referencing assessment unlocks the shared file", () => {
    expect(
      isMaterialOpen(
        [{ opens_at: at(-MIN) }, { opens_at: at(+MIN) }, { opens_at: at(+2 * MIN) }],
        NOW,
      ),
    ).toBe(true);
  });

  it("RETAINS access after the deadline (review; no re-locking, no attempt-gating)", () => {
    // Opened long ago and closed long ago — still downloadable.
    expect(isMaterialOpen([{ opens_at: at(-2 * MIN), closes_at: at(-MIN) }], NOW)).toBe(true);
    // Shared between a closed and a still-unopened assessment → any-open wins.
    expect(
      isMaterialOpen(
        [{ opens_at: at(-2 * MIN), closes_at: at(-MIN) }, { opens_at: at(+MIN) }],
        NOW,
      ),
    ).toBe(true);
  });

  it("treats null opens_at as always-open", () => {
    expect(isMaterialOpen([{ opens_at: null }], NOW)).toBe(true);
  });

  it("respects the opens_at boundary (exactly at open = downloadable)", () => {
    expect(isMaterialOpen([{ opens_at: at(0) }], NOW)).toBe(true);
    expect(isMaterialOpen([{ opens_at: at(+1) }], NOW)).toBe(false);
  });
});

/* ---------- canViewAssessment — list scoping (student vs staff) ---------- */

describe("canViewAssessment (list scoping)", () => {
  it("staff see items even before they open (teacher dashboards keep working)", () => {
    const unopened = { opens_at: at(+MIN) };
    expect(canViewAssessment(unopened, "teacher", NOW)).toBe(true);
    expect(canViewAssessment(unopened, "admin", NOW)).toBe(true);
  });

  it("students see scheduled items in lists even before they open", () => {
    expect(canViewAssessment({ opens_at: at(+MIN) }, "student", NOW)).toBe(true);
  });

  it("students see open items and RETAIN visibility after close (review)", () => {
    expect(canViewAssessment({}, "student", NOW)).toBe(true);
    expect(canViewAssessment({ opens_at: at(-MIN) }, "student", NOW)).toBe(true);
    expect(canViewAssessment({ opens_at: at(-2 * MIN), closes_at: at(-MIN) }, "student", NOW)).toBe(
      true,
    );
  });
});

/* ---------- canAccessCourse — non-enrolled rejection ---------- */

describe("canAccessCourse (course scoping)", () => {
  it("rejects non-enrolled students", () => {
    expect(canAccessCourse("student", false)).toBe(false);
  });

  it("allows enrolled students", () => {
    expect(canAccessCourse("student", true)).toBe(true);
  });

  it("staff bypass enrollment (teacher/admin see everything)", () => {
    expect(canAccessCourse("teacher", false)).toBe(true);
    expect(canAccessCourse("admin", false)).toBe(true);
    expect(canAccessCourse("teacher", true)).toBe(true);
    expect(canAccessCourse("admin", true)).toBe(true);
  });
});
