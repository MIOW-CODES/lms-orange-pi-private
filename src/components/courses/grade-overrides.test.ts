import { describe, expect, it } from "bun:test";
import {
  applyBulkColumnFill,
  clearColumnOverridesForRoster,
  extractOverrideFlagsPayload,
  formatOverridesSummary,
  type CellState,
  type OverridesState,
} from "./grade-overrides";

describe("grade-overrides pure helpers", () => {
  describe("formatOverridesSummary", () => {
    it("returns empty string when no overrides exist", () => {
      expect(formatOverridesSummary()).toBe("");
      expect(formatOverridesSummary(null)).toBe("");
      expect(formatOverridesSummary({})).toBe("");
    });

    it("formats a single column override without note", () => {
      expect(formatOverridesSummary({ pt: {} })).toBe("PT");
    });

    it("formats a single column override with note", () => {
      expect(formatOverridesSummary({ pt: { note: "Practical activity" } })).toBe(
        "PT (Practical activity)",
      );
    });

    it("formats multiple column overrides maintaining canonical order", () => {
      expect(
        formatOverridesSummary({
          ex: { note: "Special exam" },
          ww: { note: "Makeup" },
          pt: {},
        }),
      ).toBe("WW (Makeup), PT, Exam (Special exam)");
    });

    it("trims whitespace notes and ignores empty notes", () => {
      expect(formatOverridesSummary({ ww: { note: "   " } })).toBe("WW");
    });
  });

  describe("extractOverrideFlagsPayload", () => {
    it("returns empty object when no overrides exist", () => {
      expect(extractOverrideFlagsPayload()).toEqual({});
      expect(extractOverrideFlagsPayload(null)).toEqual({});
      expect(extractOverrideFlagsPayload({})).toEqual({});
    });

    it("includes only flagged keys", () => {
      const payload = extractOverrideFlagsPayload({
        ww: { note: "Lab 1" },
        pt: null,
      });
      expect(payload).toEqual({
        ww: { note: "Lab 1" },
      });
    });

    it("cleans notes and truncates at 500 characters", () => {
      const longNote = "A".repeat(600);
      const payload = extractOverrideFlagsPayload({
        ex: { note: longNote, by: "prof1", at: "2026-10-01" },
      });
      expect(payload.ex.note?.length).toBe(500);
      expect(payload.ex.by).toBe("prof1");
      expect(payload.ex.at).toBe("2026-10-01");
    });

    it("sets empty note to null", () => {
      const payload = extractOverrideFlagsPayload({
        ww: { note: "   " },
      });
      expect(payload.ww.note).toBeNull();
    });
  });

  describe("applyBulkColumnFill", () => {
    it("updates only visible students and preserves other cells and columns", () => {
      const initialCells: Record<string, CellState> = {
        s1: { ww: "80", pt: "85", ex: "90" },
        s2: { ww: "70", pt: "75", ex: "80" },
        s3: { ww: "60", pt: "65", ex: "70" },
      };
      const initialOverrides: OverridesState = {
        s1: { ww: { note: "Existing" } },
      };
      const visibleIds = ["s1", "s2"];

      const res = applyBulkColumnFill(
        initialCells,
        initialOverrides,
        visibleIds,
        "pt",
        "95",
        "Practical 2",
      );

      // s1 and s2 updated
      expect(res.cells.s1.pt).toBe("95");
      expect(res.cells.s1.ww).toBe("80");
      expect(res.cells.s2.pt).toBe("95");
      expect(res.overrides.s1.pt?.note).toBe("Practical 2");
      expect(res.overrides.s1.ww?.note).toBe("Existing");
      expect(res.overrides.s2.pt?.note).toBe("Practical 2");

      // s3 untouched
      expect(res.cells.s3.pt).toBe("65");
      expect(res.overrides.s3).toBeUndefined();
    });

    it("defaults note to 'Bulk fill' when blank", () => {
      const res = applyBulkColumnFill({}, {}, ["s1"], "ww", "100", "");
      expect(res.overrides.s1.ww?.note).toBe("Bulk fill");
    });
  });

  describe("clearColumnOverridesForRoster", () => {
    it("clears only the target column override for visible students", () => {
      const initialOverrides: OverridesState = {
        s1: { ww: { note: "Note 1" }, pt: { note: "Note 2" } },
        s2: { pt: { note: "Note 3" } },
        s3: { pt: { note: "Keep me" } },
      };
      const visibleIds = ["s1", "s2"];

      const res = clearColumnOverridesForRoster(initialOverrides, visibleIds, "pt");

      expect(res.s1.pt).toBeUndefined();
      expect(res.s1.ww?.note).toBe("Note 1");
      expect(res.s2.pt).toBeUndefined();
      expect(res.s3.pt?.note).toBe("Keep me");
    });
  });
});
