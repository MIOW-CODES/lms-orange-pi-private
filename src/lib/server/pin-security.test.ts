// PIN-security policy — pure decision logic (no DB, no network):
//  - who is flagged for a forced PIN change (pin_must_change)
//  - flag-clearing on PIN writes (self-service change / staff reset)
//  - PIN format rules for self-service changes
import { describe, expect, it } from "bun:test";
import {
  isValidPinFormat,
  canVerifyPinCandidate,
  pinGateRequiredForRole,
  hasPinWrite,
  safeProfile,
} from "./profiles.server";
import type { ProfileRow } from "./db-types";

function row(over: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "p1",
    student_id: "2025-0001",
    email: "student@example.com",
    pin: null,
    full_name: "Test Student",
    role: "student",
    rfid_uid: null,
    avatar_url: null,
    grade_level: 10,
    section: "A",
    created_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    pin_hash: null,
    username: null,
    password_hash: null,
    failed_login_attempts: 0,
    locked_until: null,
    employee_id: null,
    prefix: null,
    department: null,
    phone: null,
    ...over,
  };
}

describe("pinGateRequiredForRole — who gets flagged", () => {
  it("flags students for a forced PIN change", () => {
    expect(pinGateRequiredForRole("student")).toBe(true);
  });

  it("includes flagged teachers", () => {
    expect(pinGateRequiredForRole("teacher")).toBe(true);
  });

  it("includes flagged admins", () => {
    expect(pinGateRequiredForRole("admin")).toBe(true);
  });
});

describe("safeProfile — login responses surface the gate flag", () => {
  it("surfaces pin_must_change for a flagged student", () => {
    const p = safeProfile(row({ pin_must_change: true }));
    expect(p.pin_must_change).toBe(true);
  });

  it("reports a cleared flag after the student picked a PIN", () => {
    const p = safeProfile(row({ pin_must_change: false, pin_hash: "$2b$10$hash" }));
    expect(p.pin_must_change).toBe(false);
  });

  it("surfaces the gate for flagged staff", () => {
    const teacher = safeProfile(row({ role: "teacher", pin_must_change: true }));
    const admin = safeProfile(row({ role: "admin", pin_must_change: true }));
    expect(teacher.pin_must_change).toBe(true);
    expect(admin.pin_must_change).toBe(true);
  });

  it("treats a missing flag as not set (pre-migration sessions)", () => {
    const p = safeProfile(row());
    expect(p.pin_must_change).toBe(false);
  });
});

describe("hasPinWrite — detecting temporary or private PIN writes", () => {
  it("recognizes a PIN write (self-service change or admin reset)", () => {
    expect(hasPinWrite({ pin: "5570" })).toBe(true);
    expect(hasPinWrite({ pin: "12345678", full_name: "Renamed" })).toBe(true);
  });

  it("keeps the gate for patches without a PIN", () => {
    expect(hasPinWrite({})).toBe(false);
    expect(hasPinWrite({ full_name: "Renamed", email: "new@example.com" })).toBe(false);
  });

  it("keeps the gate when the PIN is null or empty", () => {
    expect(hasPinWrite({ pin: null })).toBe(false);
    expect(hasPinWrite({ pin: "" })).toBe(false);
  });
});

describe("isValidPinFormat — PIN validation rules", () => {
  it("accepts 4–8 digit PINs", () => {
    for (const pin of ["1234", "0000", "123456", "12345678", "9999"]) {
      expect(isValidPinFormat(pin)).toBe(true);
    }
  });

  it("rejects PINs that are too short or too long", () => {
    expect(isValidPinFormat("")).toBe(false);
    expect(isValidPinFormat("123")).toBe(false);
    expect(isValidPinFormat("123456789")).toBe(false);
  });

  it("rejects non-digit characters and whitespace", () => {
    expect(isValidPinFormat("12a4")).toBe(false);
    expect(isValidPinFormat("12 34")).toBe(false);
    expect(isValidPinFormat(" 1234")).toBe(false);
    expect(isValidPinFormat("1234 ")).toBe(false);
    expect(isValidPinFormat("１２３４")).toBe(false);
    expect(isValidPinFormat("12.4")).toBe(false);
    expect(isValidPinFormat("-1234")).toBe(false);
  });
});

describe("canVerifyPinCandidate — temporary credential compatibility", () => {
  it("permits a non-numeric temporary credential only while change is required", () => {
    expect(canVerifyPinCandidate("2026-0099", true)).toBe(true);
    expect(canVerifyPinCandidate("it10", true)).toBe(true);
    expect(canVerifyPinCandidate("it10", false)).toBe(false);
    expect(canVerifyPinCandidate("it10", null)).toBe(false);
  });

  it("continues to accept valid numeric PINs", () => {
    expect(canVerifyPinCandidate("1234", false)).toBe(true);
  });
});
