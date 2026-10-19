import { describe, it, expect } from "bun:test";
import { filterCoursesForCaller, hasCourseAccess } from "./courses.server";
import { requireEnrollment } from "./auth.server";

const catalog = [
  { id: "c-alg", code: "MATH11", title: "Algebra", grade_level: 11 },
  { id: "c-bio", code: "SCI11", title: "Biology", grade_level: 11 },
  { id: "c-hist", code: "HUM12", title: "History", grade_level: 12 },
];

describe("filterCoursesForCaller (course catalog visibility)", () => {
  it("returns only the courses a student is enrolled in", () => {
    const visible = filterCoursesForCaller(catalog, ["c-hist", "c-bio"], "student");
    expect(visible.map((c) => c.id)).toEqual(["c-bio", "c-hist"]);
  });

  it("returns nothing for a student with no enrollments", () => {
    expect(filterCoursesForCaller(catalog, [], "student")).toEqual([]);
  });

  it("never leaks a same-grade-level course the student is not enrolled in", () => {
    // c-alg shares the student's grade level — the old client-side `|| grade_level`
    // fallback leaked exactly this row. Enrollment must be the only key.
    const visible = filterCoursesForCaller(catalog, ["c-bio"], "student");
    expect(visible.map((c) => c.id)).toEqual(["c-bio"]);
    expect(visible.some((c) => c.id === "c-alg")).toBe(false);
  });

  it("ignores enrollment ids that are not in the catalog", () => {
    const visible = filterCoursesForCaller(catalog, ["c-bio", "c-ghost"], "student");
    expect(visible.map((c) => c.id)).toEqual(["c-bio"]);
  });

  it("keeps the full catalog for teachers and admins", () => {
    expect(filterCoursesForCaller(catalog, [], "teacher")).toHaveLength(catalog.length);
    expect(filterCoursesForCaller(catalog, [], "admin")).toHaveLength(catalog.length);
  });

  it("preserves row shape and catalog order", () => {
    const visible = filterCoursesForCaller(catalog, ["c-hist", "c-alg"], "student");
    expect(visible).toEqual([catalog[0], catalog[2]]);
    expect(visible[0]).toHaveProperty("code", "MATH11");
  });
});

describe("course-scoped gating (the listCourseMeetings rule)", () => {
  it("staff can read any course's meeting timetable", () => {
    expect(hasCourseAccess("teacher", false)).toBe(true);
    expect(hasCourseAccess("admin", false)).toBe(true);
  });

  it("students can only read the timetable of courses they are enrolled in", () => {
    // Drives listCourseMeetingsFn: a guessed courseId outside the student's
    // enrollment set must be rejected, while their own courses still resolve.
    expect(hasCourseAccess("student", true)).toBe(true);
    expect(hasCourseAccess("student", false)).toBe(false);
  });

  it("requireEnrollment lets staff through with no enrollment row", async () => {
    // The staff bypass is a pure early return — no DB access on this path, so
    // this exercises the real gate used by listCourseMeetingsFn. (The student
    // path is DB-backed and covered by E2E, not unit tests.)
    await expect(
      requireEnrollment("c-any", { id: "t1", role: "teacher" }),
    ).resolves.toBeUndefined();
    await expect(requireEnrollment("c-any", { id: "a1", role: "admin" })).resolves.toBeUndefined();
  });
});
