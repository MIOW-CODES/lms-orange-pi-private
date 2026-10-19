import { describe, expect, it } from "bun:test";

import { schemas, LAB_TASK_WIRING_MSG } from "@/lib/server/schemas.server";

// Every simulation (lab_task) quiz question must have a breadboarding task: its
// question text must require breadboard wiring (breadboard, wire/wiring,
// jumper, resistor or pin-to-pin). lab_task = false questions stay unconstrained.
// Mirrors the native migration that requires breadboarding in simulation questions.

const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "test-token";

/** Parse a question-bank update payload with the given patch fields. */
const parsePatch = (patch: Record<string, unknown>) =>
  schemas.questionUpdate.safeParse({ id: ID, patch, token: TOKEN });

/** Parse a quiz-creation payload carrying one question item. */
const parseCreate = (item: Record<string, unknown>) =>
  schemas.quizBundle.safeParse({
    quiz: { course_id: ID, title: "Worksheet" },
    questions: [item],
    token: TOKEN,
  });

/** Shorthand: simulation question text passes the breadboard rule? */
const simQuestion = (question: string) => parsePatch({ lab_task: true, question }).success;

describe("schemas.questionUpdate — lab_task breadboard rule", () => {
  it("rejects a simulation question whose text has no wiring terms", () => {
    const res = parsePatch({ lab_task: true, question: "Write a sketch that blinks an LED." });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.issues.map((issue) => issue.message)).toContain(LAB_TASK_WIRING_MSG);
  });

  it("rejects lab_task = true without question text", () => {
    expect(parsePatch({ lab_task: true }).success).toBe(false);
  });

  it("does not let the rubric carry the wiring requirement", () => {
    const res = parsePatch({
      lab_task: true,
      question: "Build the circuit and describe your connections.",
      correct_answer: "Rubric: Arduino wired to a breadboard with a resistor.",
    });
    expect(res.success).toBe(false);
  });

  it("accepts a simulation question that requires breadboard wiring", () => {
    const res = parsePatch({
      lab_task: true,
      question: "Wire the circuit on the breadboard, then write the sketch.",
    });
    expect(res.success).toBe(true);
  });

  it("matches every accepted wiring term, case-insensitively", () => {
    expect(simQuestion("Place the LED on the breadboard first.")).toBe(true);
    expect(simQuestion("Wire the pushbutton to digital pin 2.")).toBe(true);
    expect(simQuestion("Finish the Wiring before uploading.")).toBe(true);
    expect(simQuestion("Use a jumper to connect the LED anode.")).toBe(true);
    expect(simQuestion("Add a 220 ohm Resistor in series with the LED.")).toBe(true);
    expect(simQuestion("Make pin-to-pin connections from the Arduino to the board.")).toBe(true);
    expect(simQuestion("BREADBOARD placement matters for this task.")).toBe(true);
  });

  it("leaves non-simulation questions unconstrained", () => {
    const plain = "Write a sketch that blinks an LED.";
    expect(parsePatch({ lab_task: false, question: plain }).success).toBe(true);
    expect(parsePatch({ question: plain }).success).toBe(true);
    expect(parsePatch({ lab_task: false }).success).toBe(true);
  });
});

describe("schemas.quizBundle — lab_task breadboard rule on create", () => {
  it("rejects a simulation question without wiring terms", () => {
    const res = parseCreate({
      question: "Write a sketch that blinks an LED.",
      options: [],
      correct_answer: "Rubric: A working sketch.",
      lab_task: true,
    });
    expect(res.success).toBe(false);
  });

  it("accepts a simulation question that requires breadboard wiring", () => {
    const res = parseCreate({
      question: "Wire the LED circuit on the breadboard, then write the sketch.",
      options: [],
      correct_answer: "Rubric: A working sketch and a wired breadboard circuit.",
      lab_task: true,
    });
    expect(res.success).toBe(true);
  });

  it("leaves lab_task = false questions unconstrained", () => {
    const res = parseCreate({
      question: "Write a sketch that blinks an LED.",
      options: [],
      correct_answer: "Rubric: A working sketch.",
      lab_task: false,
    });
    expect(res.success).toBe(true);
  });
});
