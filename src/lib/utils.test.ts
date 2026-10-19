import { describe, it, expect } from "bun:test";
import { cn, gradeLevelLabel, sanitizeDecimal } from "./utils";

describe("cn", () => {
  it("merges a single class", () => {
    expect(cn("foo")).toBe("foo");
  });

  it("merges multiple classes", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles falsy values", () => {
    expect(cn("foo", false, null, undefined, 0, "")).toBe("foo");
  });

  it("concatenates identical classes", () => {
    expect(cn("foo", "foo")).toBe("foo foo");
  });

  it("resolves tailwind conflicts — later wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("merges conditional classes", () => {
    const active = true;
    const disabled = false;
    expect(cn("base", active && "active", disabled && "disabled")).toBe("base active");
  });

  it("handles arrays", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
    expect(cn(["p-2", "p-4"])).toBe("p-4");
  });

  it("handles objects", () => {
    expect(cn({ foo: true, bar: false })).toBe("foo");
    expect(cn({ "p-2": false, "p-4": true })).toBe("p-4");
  });

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });

  it("handles empty string inputs", () => {
    expect(cn("", "foo", "")).toBe("foo");
  });
});

describe("gradeLevelLabel", () => {
  it("labels junior and senior high levels", () => {
    expect(gradeLevelLabel(7)).toBe("Grade 7");
    expect(gradeLevelLabel(10)).toBe("Grade 10");
    expect(gradeLevelLabel(11)).toBe("Grade 11");
    expect(gradeLevelLabel(12)).toBe("Grade 12");
  });

  it("labels college year levels with correct ordinals", () => {
    expect(gradeLevelLabel(13)).toBe("1st Year");
    expect(gradeLevelLabel(14)).toBe("2nd Year");
    expect(gradeLevelLabel(15)).toBe("3rd Year");
    expect(gradeLevelLabel(16)).toBe("4th Year");
  });

  it("supports the short form", () => {
    expect(gradeLevelLabel(9, true)).toBe("G9");
    expect(gradeLevelLabel(13, true)).toBe("1st Yr");
    expect(gradeLevelLabel(16, true)).toBe("4th Yr");
  });

  it("returns a dash for null/undefined", () => {
    expect(gradeLevelLabel(null)).toBe("—");
    expect(gradeLevelLabel(undefined)).toBe("—");
  });
});

describe("sanitizeDecimal", () => {
  it("keeps digits and a single decimal point", () => {
    expect(sanitizeDecimal("95")).toBe("95");
    expect(sanitizeDecimal("87.5")).toBe("87.5");
  });

  it("strips non-numeric characters", () => {
    expect(sanitizeDecimal("9a5!")).toBe("95");
    expect(sanitizeDecimal("abc")).toBe("");
  });

  it("collapses multiple decimal points", () => {
    expect(sanitizeDecimal("1.2.3")).toBe("1.23");
    expect(sanitizeDecimal("..5")).toBe(".5");
  });
});
