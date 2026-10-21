import { matchesIdentification } from "@/lib/answer-matching";

export interface IT10RepairQuestion {
  id: string;
  correct_answer: string;
  options: string[];
}

export interface IT10RepairResult {
  id: string;
  chosen: string | null;
  correct: boolean;
}

export interface IT10RepairAttempt {
  id: string;
  student_id: string;
  results: IT10RepairResult[] | null;
}

export interface IT10RepairReview {
  attempt_id: string;
  question_id: string;
}

export interface IT10RepairProposal {
  attemptId: string;
  questionId: string;
  studentId: string;
  reason: string;
}

function reviewKey(attemptId: string, questionId: string) {
  return `${attemptId}\u0000${questionId}`;
}

/** Build data-independent corrections for unanswered identification formats. */
export function buildIT10RepairProposals(
  questions: IT10RepairQuestion[],
  attempts: IT10RepairAttempt[],
  reviews: IT10RepairReview[],
): IT10RepairProposal[] {
  const questionsById = new Map<string, IT10RepairQuestion>();
  for (const question of questions) {
    if (!questionsById.has(question.id)) questionsById.set(question.id, question);
  }

  const reviewedAnswers = new Set(
    reviews.map((review) => reviewKey(review.attempt_id, review.question_id)),
  );
  const proposals: IT10RepairProposal[] = [];

  for (const attempt of attempts) {
    for (const result of attempt.results ?? []) {
      const question = questionsById.get(result.id);
      if (
        result.correct ||
        !result.chosen ||
        !question ||
        question.options.length > 0 ||
        question.correct_answer.startsWith("Rubric:") ||
        reviewedAnswers.has(reviewKey(attempt.id, result.id)) ||
        !matchesIdentification(result.chosen, question.correct_answer)
      ) {
        continue;
      }

      proposals.push({
        attemptId: attempt.id,
        questionId: result.id,
        studentId: attempt.student_id,
        reason: "Answer matches the saved identification key.",
      });
    }
  }

  return proposals;
}
