import { describe, expect, it } from "bun:test";
import { enforcePinChangeGate, enforceRole } from "./auth.server";

describe("server authorization policies", () => {
  it("allows only the current administrator role through admin guards", () => {
    const admin = { id: "current-admin", role: "admin" };
    expect(enforceRole(admin, ["admin"])).toBe(admin);
    expect(() => enforceRole({ id: "student", role: "student" }, ["admin"])).toThrow("Forbidden");
    expect(() => enforceRole({ id: "teacher", role: "teacher" }, ["admin"])).toThrow("Forbidden");
  });

  it("allows teachers through staff guards but excludes students", () => {
    expect(enforceRole({ role: "teacher" }, ["teacher", "admin"])).toMatchObject({
      role: "teacher",
    });
    expect(() => enforceRole({ role: "student" }, ["teacher", "admin"])).toThrow("Forbidden");
  });

  it("re-evaluates the current role after a role change", () => {
    const profile = { id: "changed-user", role: "admin" };
    expect(enforceRole(profile, ["admin"])).toBe(profile);

    profile.role = "teacher";
    expect(() => enforceRole(profile, ["admin"])).toThrow("Forbidden");
  });

  it("blocks flagged accounts from portal access except for the PIN replacement flow", () => {
    const profile = { id: "temporary-admin", role: "admin", pin_must_change: true };
    expect(() => enforcePinChangeGate(profile, false)).toThrow(
      "Choose a new PIN before continuing.",
    );
    expect(enforcePinChangeGate(profile, true)).toBe(profile);
    expect(enforcePinChangeGate({ pin_must_change: false }, false)).toMatchObject({
      pin_must_change: false,
    });
  });
});
