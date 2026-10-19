import { describe, expect, it } from "bun:test";
import { schemas } from "./schemas.server";

/* Regression guard for the profile/student-enroll schema refactor. */

describe("schemas.profileInput", () => {
  it("accepts a minimal student payload", () => {
    const parsed = schemas.profileInput.parse({
      full_name: "Ana Reyes",
      student_id: "2026-0042",
      token: "t",
    });
    expect(parsed.full_name).toBe("Ana Reyes");
  });

  it("accepts the full optional student field set", () => {
    const parsed = schemas.profileInput.parse({
      full_name: "Ana Reyes",
      student_id: "2026-0042",
      email: "ana.reyes@g.msuiit.edu.ph",
      role: "student",
      grade_level: 12,
      section: "B8",
      pin: "123456",
      rfid_uid: "1234567890",
      avatar_url: "https://example.com/a.png",
      token: "t",
    });
    expect(parsed.grade_level).toBe(12);
  });

  it("rejects an invalid PIN", () => {
    expect(() =>
      schemas.profileInput.parse({ full_name: "X", student_id: "1", pin: "abc", token: "t" }),
    ).toThrow();
  });
});

describe("schemas.studentEnroll", () => {
  it("accepts a student with a course to enroll into", () => {
    const parsed = schemas.studentEnroll.parse({
      full_name: "Ana Reyes",
      student_id: "2026-0042",
      course_id: "11111111-1111-4111-8111-111111111111",
      token: "t",
    });
    expect(parsed.course_id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("accepts a student with no course (bare record)", () => {
    const parsed = schemas.studentEnroll.parse({
      full_name: "Ana Reyes",
      student_id: "2026-0042",
      token: "t",
    });
    expect(parsed.course_id).toBeUndefined();
  });

  it("rejects a malformed course id", () => {
    expect(() =>
      schemas.studentEnroll.parse({
        full_name: "Ana Reyes",
        student_id: "2026-0042",
        course_id: "not-a-uuid",
        token: "t",
      }),
    ).toThrow();
  });
});

/* Regression guard: pin-on-create must survive announcementInput parsing. */

describe("schemas.announcementInput — pinned", () => {
  it("keeps pinned on create (previously stripped by the schema)", () => {
    const parsed = schemas.announcementInput.parse({
      title: "Enrollment opens",
      content: "Enrollment for Q2 opens on Monday.",
      category: "academic",
      pinned: true,
      token: "t",
    });
    expect(parsed.pinned).toBe(true);
  });

  it("still accepts a payload without pinned", () => {
    const parsed = schemas.announcementInput.parse({
      title: "Enrollment opens",
      content: "Enrollment for Q2 opens on Monday.",
      category: "academic",
      token: "t",
    });
    expect(parsed.pinned).toBeUndefined();
  });
});

/* Regression guard: an MCQ answer key that is not one of the options makes the
 * question impossible to answer correctly (the chosen option can never equal
 * the key). Enforced on the quizBundle create path only — updateQuestion /
 * quizUpdate stay lenient so existing rows and edits are unaffected. */

const QUIZ_UUID = "22222222-2222-4222-8222-222222222222";

/** Parse a quiz-creation payload carrying one question item. */
const parseBundleQuestion = (item: Record<string, unknown>) =>
  schemas.quizBundle.safeParse({
    quiz: { course_id: QUIZ_UUID, title: "Worksheet" },
    questions: [item],
    token: "t",
  });

describe("schemas.quizBundle — MCQ answer key must be one of the options", () => {
  it("accepts a valid MCQ whose correct answer is an option", () => {
    const res = parseBundleQuestion({
      question: "What is 2 + 2?",
      options: ["3", "4", "5"],
      correct_answer: "4",
    });
    expect(res.success).toBe(true);
  });

  it("rejects an MCQ whose correct answer is not among the options", () => {
    const res = parseBundleQuestion({
      question: "What is 2 + 2?",
      options: ["3", "4", "5"],
      correct_answer: "6",
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.issues.map((issue) => issue.message)).toContain(
      "correct answer must be one of the options",
    );
  });

  it("exempts a Rubric: essay question with empty options", () => {
    const res = parseBundleQuestion({
      question: "Explain Ohm's law in your own words.",
      options: [],
      correct_answer: "Rubric: must mention voltage, current, and resistance",
    });
    expect(res.success).toBe(true);
  });

  it("accepts an answer-variant key when its first variant is an option", () => {
    const res = parseBundleQuestion({
      question: "Which of these is a passive component?",
      options: ["Resistor", "Transistor", "Op-amp"],
      correct_answer: "Resistor || resistor",
    });
    expect(res.success).toBe(true);
  });
});
