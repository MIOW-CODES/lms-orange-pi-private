import { describe, expect, it } from "bun:test";
import { countStudentTasks, countStaffTasks, taskCountForPath } from "./pending-tasks";

describe("pending task counts", () => {
  it("keeps missing and draft activities pending until submitted or graded", () => {
    const activities = ["missing", "draft", "sent", "marked"].map((id) => ({ id }));
    const counts = countStudentTasks(
      activities,
      [],
      [
        { assignment_id: "draft", status: "pending" },
        { assignment_id: "sent", status: "submitted" },
        { assignment_id: "marked", status: "graded" },
        { assignment_id: "another-course", status: "submitted" },
      ],
      [],
    );
    expect(counts.activities).toBe(2);
    expect(
      countStudentTasks(activities, [], [{ assignment_id: "missing", status: "submitted" }], [])
        .activities,
    ).toBe(3);
  });
  it("clears worksheets on the first submitted attempt, including a zero score, without requiring optional retakes", () => {
    expect(
      countStudentTasks(
        [],
        [{ id: "new" }, { id: "done" }],
        [],
        [{ quiz_id: "done" }, { quiz_id: "done" }],
      ).worksheets,
    ).toBe(1);
  });
  it("counts submitted activities awaiting grading and one release task per unreleased worksheet", () => {
    const counts = countStaffTasks(
      [{ status: "pending" }, { status: "submitted" }, { status: "graded" }],
      [
        { id: "release", score_released: false },
        { id: "released", score_released: true },
        { id: "empty", score_released: false },
      ],
      [{ quiz_id: "release" }, { quiz_id: "release" }, { quiz_id: "released" }],
    );
    expect(counts.grading).toBe(1);
    expect(counts.scoreReleases).toBe(1);
    expect(taskCountForPath("/dashboard/teacher/courses", "teacher", counts)).toBe(2);
    expect(taskCountForPath("/dashboard/admin/courses", "admin", counts)).toBe(2);
    expect(taskCountForPath("/dashboard/teacher/grades", "teacher", counts)).toBe(1);
    expect(taskCountForPath("/dashboard/student/assignments", "student", counts)).toBe(0);
  });
  it("includes pending assignments in the student's course notification count", () => {
    expect(
      taskCountForPath("/dashboard/student/courses", "student", {
        activities: 1,
        worksheets: 19,
        grading: 0,
        scoreReleases: 0,
      }),
    ).toBe(20);
  });
  it("does not invent badges for destinations without tasks or absent data", () => {
    expect(
      taskCountForPath("/dashboard/student/arduino", "student", {
        activities: 4,
        worksheets: 3,
        grading: 0,
        scoreReleases: 0,
      }),
    ).toBe(0);
    expect(taskCountForPath("/dashboard/student/assignments", "student")).toBe(0);
  });
});
