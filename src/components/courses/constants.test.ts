import { describe, expect, it } from "bun:test";
import { classmateBankSize, policyPayload, EMPTY_POLICY } from "./constants";

describe("classmateBankSize", () => {
  it("defaults to 20 when no per-student count is set", () => {
    expect(classmateBankSize(0)).toBe(20);
    expect(classmateBankSize(-5)).toBe(20);
  });

  it("asks for a larger bank so per-student subsets can differ", () => {
    expect(classmateBankSize(10)).toBe(30);
    expect(classmateBankSize(5)).toBe(15);
  });

  it("keeps at least +10 headroom for small counts", () => {
    expect(classmateBankSize(1)).toBe(11);
    expect(classmateBankSize(2)).toBe(12);
  });

  it("caps the request at 100", () => {
    expect(classmateBankSize(50)).toBe(100);
    expect(classmateBankSize(200)).toBe(100);
  });

  it("treats non-finite input as unset", () => {
    expect(classmateBankSize(NaN)).toBe(20);
    expect(classmateBankSize(Infinity)).toBe(20);
  });
});

describe("policyPayload", () => {
  it("forces a single attempt when retakes are disabled", () => {
    expect(policyPayload({ ...EMPTY_POLICY, allow_retake: false, max_attempts: "5" })).toEqual({
      allow_retake: false,
      max_attempts: 1,
      retake_score_policy: "highest_score",
    });
  });

  it("uses unlimited (0) when enabled with the unlimited flag", () => {
    expect(
      policyPayload({ ...EMPTY_POLICY, allow_retake: true, unlimited: true, max_attempts: "5" }),
    ).toMatchObject({ allow_retake: true, max_attempts: 0 });
  });
});
