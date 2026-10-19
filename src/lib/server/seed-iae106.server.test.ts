import { describe, expect, it } from "bun:test";

describe("seed-iae106 metadata", () => {
  it("imports without throwing", async () => {
    const mod = await import("./seed-iae106.server");
    expect(typeof mod.seedIae106CourseAndQuizzes).toBe("function");
  });

  it("selects students only from the configured grade and section cohort", async () => {
    const { isIae106Cohort } = await import("./seed-iae106.server");
    expect(isIae106Cohort({ grade_level: 14, section: null })).toBe(true);
    expect(isIae106Cohort({ grade_level: null, section: " BTLED-2A " })).toBe(true);
    expect(isIae106Cohort({ grade_level: null, section: "b8" })).toBe(true);
    expect(isIae106Cohort({ grade_level: 13, section: "BSIT-2A" })).toBe(false);
  });

  it("does not enroll demo/test identities as cohort exceptions", async () => {
    const { isIae106Cohort } = await import("./seed-iae106.server");
    const testIdentity = {
      grade_level: null,
      section: null,
      student_id: "2026-0000",
      email: "test@example.invalid",
    };
    expect(isIae106Cohort(testIdentity)).toBe(false);
  });
});
