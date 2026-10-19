import { describe, expect, it } from "bun:test";
import {
  DEFAULT_QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  WORKSHEET_QUESTION_TYPES,
  formatQuestionTypes,
  isWorksheetQuestionType,
  normalizeQuestionTypes,
} from "@/lib/worksheet-types";

describe("worksheet-types", () => {
  it("exposes the four supported question types", () => {
    expect(WORKSHEET_QUESTION_TYPES).toEqual(["mc", "fill", "matching", "essay"]);
    for (const t of WORKSHEET_QUESTION_TYPES) {
      expect(QUESTION_TYPE_LABELS[t]).toBeTruthy();
    }
  });

  it("defaults to multiple choice + fill in the blank", () => {
    expect(DEFAULT_QUESTION_TYPES).toEqual(["mc", "fill"]);
  });

  it("isWorksheetQuestionType narrows only known values", () => {
    expect(isWorksheetQuestionType("mc")).toBe(true);
    expect(isWorksheetQuestionType("essay")).toBe(true);
    expect(isWorksheetQuestionType("nope")).toBe(false);
    expect(isWorksheetQuestionType(undefined)).toBe(false);
    expect(isWorksheetQuestionType(3)).toBe(false);
  });

  it("normalizeQuestionTypes drops invalid values, de-dupes, and reorders canonically", () => {
    expect(normalizeQuestionTypes(["essay", "mc", "essay", "bogus"])).toEqual(["mc", "essay"]);
    expect(normalizeQuestionTypes(undefined)).toEqual([]);
    expect(normalizeQuestionTypes([])).toEqual([]);
  });

  it("formatQuestionTypes produces readable lists", () => {
    expect(formatQuestionTypes([])).toBe("");
    expect(formatQuestionTypes(["mc"])).toBe("Multiple Choice");
    expect(formatQuestionTypes(["mc", "fill"])).toBe("Multiple Choice and Fill in the Blank");
    expect(formatQuestionTypes(["mc", "fill", "essay"])).toBe(
      "Multiple Choice, Fill in the Blank, and Essay / Short Answer",
    );
  });
});
