import { describe, expect, it } from "bun:test";
import {
  assignmentActionLabel,
  canAttemptWorksheet,
  worksheetActionLabel,
} from "./assessment-actions";

describe("worksheetActionLabel", () => {
  it("shows Start (never Retake) on a first, unattempted try", () => {
    expect(worksheetActionLabel({ attemptsUsed: 0, canRetake: true })).toBe("Start");
    expect(worksheetActionLabel({ attemptsUsed: 0, canRetake: false })).toBe("Start");
  });

  it("shows Retake after an attempt when retakes are allowed", () => {
    expect(worksheetActionLabel({ attemptsUsed: 1, canRetake: true })).toBe("Retake");
    expect(worksheetActionLabel({ attemptsUsed: 3, canRetake: true })).toBe("Retake");
  });

  it("shows View once the attempt ceiling is reached", () => {
    expect(worksheetActionLabel({ attemptsUsed: 1, canRetake: false })).toBe("View");
  });
});

describe("canAttemptWorksheet", () => {
  it("allows a first attempt regardless of the retake flag", () => {
    expect(canAttemptWorksheet({ attemptsUsed: 0, canRetake: false })).toBe(true);
  });

  it("follows the retake policy after an attempt", () => {
    expect(canAttemptWorksheet({ attemptsUsed: 1, canRetake: true })).toBe(true);
    expect(canAttemptWorksheet({ attemptsUsed: 1, canRetake: false })).toBe(false);
  });
});

describe("assignmentActionLabel", () => {
  it("prompts Submit when unsubmitted or pending", () => {
    expect(assignmentActionLabel({ status: undefined })).toBe("Submit");
    expect(assignmentActionLabel({ status: "pending" })).toBe("Submit");
  });

  it("shows View once submitted or graded", () => {
    expect(assignmentActionLabel({ status: "submitted" })).toBe("View");
    expect(assignmentActionLabel({ status: "graded" })).toBe("View");
  });
});
