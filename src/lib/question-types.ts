export const QUESTION_TYPE_LABELS = {
  multiple_choice: "Multiple choice",
  matching: "Matching",
  essay: "Essay",
  identification: "Identification",
} as const;

export type QuestionType = keyof typeof QUESTION_TYPE_LABELS;
