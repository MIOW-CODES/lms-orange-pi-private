import { describe, expect, it } from "bun:test";
import { buildIT10RepairProposals } from "./it10-report-repair.logic.server";

describe("IT10 identification repair proposals", () => {
  it("proposes only matching, unreviewed free-response answers", () => {
    const proposals = buildIT10RepairProposals(
      [
        { id: "identify-1", correct_answer: "Cebu City", options: [] },
        { id: "identify-2", correct_answer: "Mango", options: [] },
        { id: "multiple-choice", correct_answer: "Choice A", options: ["Choice A"] },
        { id: "essay", correct_answer: "Rubric: award credit for a coherent answer", options: [] },
      ],
      [
        {
          id: "attempt-1",
          student_id: "student-1",
          results: [
            { id: "identify-1", chosen: "cebu city", correct: false },
            { id: "identify-2", chosen: "Mango", correct: false },
            { id: "multiple-choice", chosen: "Choice A", correct: false },
            { id: "essay", chosen: "A coherent answer", correct: false },
            { id: "missing-question", chosen: "Some answer", correct: false },
          ],
        },
        {
          id: "attempt-2",
          student_id: "student-2",
          results: [{ id: "identify-1", chosen: "CEBU CITY", correct: false }],
        },
      ],
      [{ attempt_id: "attempt-1", question_id: "identify-1" }],
    );

    expect(proposals).toEqual([
      {
        attemptId: "attempt-1",
        questionId: "identify-2",
        studentId: "student-1",
        reason: "Answer matches the saved identification key.",
      },
      {
        attemptId: "attempt-2",
        questionId: "identify-1",
        studentId: "student-2",
        reason: "Answer matches the saved identification key.",
      },
    ]);
  });

  it("keeps proposal order and ignores already-correct or empty results", () => {
    const proposals = buildIT10RepairProposals(
      [{ id: "q1", correct_answer: "North", options: [] }],
      [
        {
          id: "attempt-1",
          student_id: "student-1",
          results: [
            { id: "q1", chosen: "North", correct: true },
            { id: "q1", chosen: " ", correct: false },
            { id: "q1", chosen: "north", correct: false },
          ],
        },
      ],
      [],
    );

    expect(proposals.map(({ attemptId, questionId }) => ({ attemptId, questionId }))).toEqual([
      { attemptId: "attempt-1", questionId: "q1" },
    ]);
  });
});
