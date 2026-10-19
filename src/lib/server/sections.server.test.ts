import { describe, it, expect } from "bun:test";
import { missingEnrollments } from "./sections.server";

describe("missingEnrollments", () => {
  it("returns candidates that are not yet enrolled", () => {
    expect(missingEnrollments(["a", "b"], ["a", "b", "c", "d"])).toEqual(["c", "d"]);
  });

  it("returns [] when every candidate is already enrolled", () => {
    expect(missingEnrollments(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
  });

  it("returns all candidates when nothing is enrolled yet", () => {
    expect(missingEnrollments([], ["x", "y"])).toEqual(["x", "y"]);
  });

  it("dedupes repeated candidates while preserving order", () => {
    expect(missingEnrollments([], ["x", "y", "x", "z", "y"])).toEqual(["x", "y", "z"]);
  });

  it("drops empty and non-string ids", () => {
    expect(missingEnrollments([], ["", "a", "", "b"])).toEqual(["a", "b"]);
  });

  it("returns [] for empty inputs", () => {
    expect(missingEnrollments([], [])).toEqual([]);
    expect(missingEnrollments(["a"], [])).toEqual([]);
  });
});
