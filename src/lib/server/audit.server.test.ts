import { describe, expect, it } from "bun:test";
import { clampAuditDetail } from "./audit.server";

describe("clampAuditDetail", () => {
  it("passes short details through unchanged", () => {
    expect(clampAuditDetail("Role updated · user 123")).toBe("Role updated · user 123");
  });

  it("keeps detail at exactly the max length boundary", () => {
    const exact = "x".repeat(500);
    expect(clampAuditDetail(exact)).toBe(exact);
  });

  it("truncates long details to 500 chars ending in an ellipsis", () => {
    const out = clampAuditDetail("y".repeat(600));
    expect(out.length).toBe(500);
    expect(out.endsWith("…")).toBe(true);
  });

  it("treats nullish detail as empty", () => {
    expect(clampAuditDetail(undefined as unknown as string)).toBe("");
    expect(clampAuditDetail(null as unknown as string)).toBe("");
  });
});
