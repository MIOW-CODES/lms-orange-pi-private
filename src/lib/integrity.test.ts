import { describe, expect, it } from "bun:test";
import {
  INTEGRITY_EVENT_TYPES,
  integrityLabel,
  isSevereIntegrityEvent,
  switchSeverity,
} from "./integrity";

describe("integrity helpers", () => {
  it("labels every event type", () => {
    for (const type of INTEGRITY_EVENT_TYPES) {
      expect(integrityLabel(type).length).toBeGreaterThan(0);
    }
  });

  it("treats devtools / fullscreen exit / paste as severe", () => {
    expect(isSevereIntegrityEvent("devtools")).toBe(true);
    expect(isSevereIntegrityEvent("fullscreenchange")).toBe(true);
    expect(isSevereIntegrityEvent("paste")).toBe(true);
    expect(isSevereIntegrityEvent("blur")).toBe(false);
    expect(isSevereIntegrityEvent("contextmenu")).toBe(false);
    expect(isSevereIntegrityEvent("visibilitychange")).toBe(false);
  });

  it("scales severity colors with the count", () => {
    expect(switchSeverity(0).label).toBe("No switches");
    expect(switchSeverity(1).text).toContain("amber");
    expect(switchSeverity(4).text).toContain("rose");
  });
});
