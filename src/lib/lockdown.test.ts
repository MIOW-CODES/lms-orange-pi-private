import { describe, it, expect, beforeEach } from "bun:test";
import {
  getLockdownMode,
  resetLockdown,
  setLockdownDemand,
  shouldKioskLockdown,
  subscribeLockdown,
} from "./lockdown";

beforeEach(() => {
  resetLockdown();
});

describe("shouldKioskLockdown", () => {
  it("locks student sessions when the setting is on", () => {
    expect(shouldKioskLockdown("student", true)).toBe(true);
  });

  it("stays off for students when the setting is off", () => {
    expect(shouldKioskLockdown("student", false)).toBe(false);
  });

  it("never locks teachers, admins, or signed-out visitors", () => {
    expect(shouldKioskLockdown("teacher", true)).toBe(false);
    expect(shouldKioskLockdown("admin", true)).toBe(false);
    expect(shouldKioskLockdown(null, true)).toBe(false);
    expect(shouldKioskLockdown(undefined, true)).toBe(false);
    expect(shouldKioskLockdown("", true)).toBe(false);
  });

  it("requires the setting to be exactly true", () => {
    expect(shouldKioskLockdown("student", "true" as unknown as boolean)).toBe(false);
    expect(shouldKioskLockdown("student", 1 as unknown as boolean)).toBe(false);
  });
});

describe("lockdown mode composition", () => {
  it("is null when nothing demands the lock", () => {
    expect(getLockdownMode()).toBeNull();
  });

  it("reports kiosk mode for the app-wide demand", () => {
    setLockdownDemand("kiosk", true);
    expect(getLockdownMode()).toBe("kiosk");
  });

  it("reports exam mode for the exam demand", () => {
    setLockdownDemand("exam", true);
    expect(getLockdownMode()).toBe("exam");
  });

  it("gives exam copy priority while both demands are active", () => {
    setLockdownDemand("kiosk", true);
    setLockdownDemand("exam", true);
    expect(getLockdownMode()).toBe("exam");
  });

  it("falls back to kiosk when the exam ends on a locked device", () => {
    setLockdownDemand("kiosk", true);
    setLockdownDemand("exam", true);
    setLockdownDemand("exam", false);
    expect(getLockdownMode()).toBe("kiosk");
  });

  it("returns to null when all demands are cleared", () => {
    setLockdownDemand("kiosk", true);
    setLockdownDemand("exam", true);
    setLockdownDemand("exam", false);
    setLockdownDemand("kiosk", false);
    expect(getLockdownMode()).toBeNull();
  });

  it("notifies subscribers only when a demand actually changes", () => {
    let calls = 0;
    const unsubscribe = subscribeLockdown(() => {
      calls += 1;
    });
    setLockdownDemand("kiosk", true);
    setLockdownDemand("kiosk", true); // already on — no notification
    expect(calls).toBe(1);
    unsubscribe();
    setLockdownDemand("kiosk", false);
    expect(calls).toBe(1);
  });
});
