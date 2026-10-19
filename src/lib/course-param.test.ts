import { describe, expect, it } from "bun:test";
import { readCourseParam } from "@/lib/course-param";

describe("readCourseParam", () => {
  it("returns null for an empty query string", () => {
    expect(readCourseParam("")).toBeNull();
  });

  it("returns null when the param is absent", () => {
    expect(readCourseParam("?foo=bar")).toBeNull();
  });

  it("returns null when the param is blank", () => {
    expect(readCourseParam("?course=")).toBeNull();
    expect(readCourseParam("?course=%20%20")).toBeNull();
  });

  it("returns the course id when present", () => {
    expect(readCourseParam("?course=056eb697-e785-4f6b-810e-2844fe1161dc")).toBe(
      "056eb697-e785-4f6b-810e-2844fe1161dc",
    );
  });

  it("ignores unrelated params", () => {
    expect(readCourseParam("?tab=worksheets&course=abc123")).toBe("abc123");
  });
});
