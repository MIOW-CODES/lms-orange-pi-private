import { describe, it, expect } from "bun:test";
import type { Pool } from "pg";
import { _setPoolForTests } from "@/integrations/db/client.server";
import { createOrEnrollStudent, filterCoursesForCaller, hasCourseAccess } from "./courses.server";
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

describe("createOrEnrollStudent role boundary", () => {
  it("persists a new roster profile as a student even if called with a forged role", async () => {
    let insertedRow: Record<string, unknown> | undefined;
    const fakePool = {
      async query(sql: string, values: unknown[] = []) {
        if (sql.startsWith('INSERT INTO public."profiles"')) {
          const columns = sql.match(/\(([^)]*)\) VALUES/)?.[1];
          if (!columns) throw new Error("Unexpected profile insert SQL");
          const names = columns.split(",").map((name) => name.trim().replaceAll('"', ""));
          insertedRow = Object.fromEntries(names.map((name, index) => [name, values[index]]));
          return {
            rows: [
              {
                id: "synthetic-profile-id",
                email: null,
                full_name: "Synthetic Student",
                role: "student",
                avatar_url: null,
                grade_level: null,
                section: null,
                created_at: "2026-10-21T00:00:00.000Z",
                employee_id: null,
                prefix: null,
                department: null,
                phone: null,
                bio: null,
                office_hours: null,
                pin: null,
                pin_hash: null,
                pin_must_change: false,
                rfid_uid: null,
                ...insertedRow,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    } as unknown as Pool;

    _setPoolForTests(fakePool);
    try {
      const input = {
        full_name: "Synthetic Student",
        student_id: "SYNTH-ROLE-01",
        role: "admin",
        token: "synthetic-session",
      } as unknown as Parameters<typeof createOrEnrollStudent>[0];
      const result = await createOrEnrollStudent(input, {
        id: "synthetic-teacher-id",
        role: "teacher",
      });

      expect(result.profile.role).toBe("student");
      expect(insertedRow?.["role"]).toBe("student");
    } finally {
      _setPoolForTests(undefined);
    }
  });
});
