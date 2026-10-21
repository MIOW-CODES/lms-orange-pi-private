/** Deliberate maintenance entry point, used only by scripts/repair-it10-reports.ts. */
import { db } from "@/integrations/db/client.server";
import { writeAuditLog } from "./audit.server";
import { buildIT10RepairProposals } from "./it10-report-repair.logic.server";
import { unwrap } from "./utils.server";

interface Attempt {
  id: string;
  quiz_id: string;
  student_id: string;
  results: Array<{ id: string; chosen: string | null; correct: boolean }>;
}

export async function repairIT10Reports(apply = false) {
  const course = await unwrap<{ id: string }>(
    db.from("courses").select("id").eq("code", "IT10").single(),
  );
  const quizzes = await unwrap<Array<{ id: string }>>(
    db.from("quizzes").select("id").eq("course_id", course.id).is("deleted_at", null),
  );
  const quizIds = quizzes.map((quiz) => quiz.id);
  if (quizIds.length === 0) {
    return { mode: apply ? "applied" : "preview", changes: [] };
  }

  const [questions, attempts] = await Promise.all([
    unwrap<Array<{ id: string; correct_answer: string; options: string[] }>>(
      db.from("quiz_questions").select("id,correct_answer,options").in("quiz_id", quizIds),
    ),
    unwrap<Attempt[]>(
      db.from("quiz_attempts").select("id,quiz_id,student_id,results").in("quiz_id", quizIds),
    ),
  ]);

  const attemptIds = attempts.map((attempt) => attempt.id);
  const reviews = attemptIds.length
    ? await unwrap<Array<{ attempt_id: string; question_id: string }>>(
        db
          .from("quiz_question_reviews")
          .select("attempt_id,question_id")
          .in("attempt_id", attemptIds),
      )
    : [];
  const proposals = buildIT10RepairProposals(questions, attempts, reviews);
  const changes = proposals.map(({ attemptId, questionId, reason }) => ({
    attemptId,
    questionId,
    reason,
  }));

  if (!apply) return { mode: "preview", changes };

  for (const proposal of proposals) {
    const result = await db.rpc("review_attempt_question", {
      p_attempt: proposal.attemptId,
      p_question: proposal.questionId,
      p_correct: true,
      p_expected: false,
      p_reason: proposal.reason,
      p_actor: null,
    });
    if (result.error) {
      throw new Error(`Could not review attempt question: ${result.error.message}`);
    }
    await writeAuditLog(
      null,
      "Quiz identification answer corrected",
      `Attempt ${proposal.attemptId}; question ${proposal.questionId}; ${proposal.reason}`,
    );
  }

  return { mode: "applied", changes };
}
