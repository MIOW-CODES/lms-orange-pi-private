import { describe, expect, it } from "bun:test";
import { ENROLLMENT_ERRORS } from "./enrollment";

describe("ENROLLMENT_ERRORS", () => {
  it("names the conflicting role so admins can troubleshoot", () => {
    expect(ENROLLMENT_ERRORS.nonStudent("teacher")).toContain("teacher");
    expect(ENROLLMENT_ERRORS.nonStudent("admin")).toContain("admin");
  });

  it("has a stable not-found message", () => {
    expect(ENROLLMENT_ERRORS.notFound).toBe("Student not found");
  });
});
