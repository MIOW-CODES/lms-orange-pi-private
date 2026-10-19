/** Deliberate maintenance entry point, used only by scripts/repair-it10-reports.ts. */
import { db } from "@/integrations/db/client.server";
import { unwrap } from "./utils.server";
import { writeAuditLog } from "./audit.server";
import { gradeEssay } from "./quizzes.server";
import { matchesIdentification, normalizeIdentification } from "@/lib/answer-matching";
interface Result {
  id: string;
  chosen: string | null;
  correct: boolean;
  correct_answer: string;
  options: string[];
}
interface Attempt {
  id: string;
  quiz_id: string;
  student_id: string;
  attempt_number: number;
  results: Result[];
  score: number;
  total: number;
}
const marker = "[class-record-repair-v1]";
export async function repairIT10Reports(apply = false) {
  const course = await unwrap<{ id: string }>(
    db.from("courses").select("id").eq("code", "IT10").single(),
  );
  const quizzes = await unwrap<Array<{ id: string; title: string; closes_at: string | null }>>(
    db
      .from("quizzes")
      .select("id,title,closes_at")
      .eq("course_id", course.id)
      .is("deleted_at", null),
  );
  const quizIds = quizzes.map((q) => q.id);
  const [questions, attempts, reviews, reports] = await Promise.all([
    unwrap<Array<{ id: string; correct_answer: string; options: string[] }>>(
      db.from("quiz_questions").select("id,correct_answer,options").in("quiz_id", quizIds),
    ),
    unwrap<Attempt[]>(
      db
        .from("quiz_attempts")
        .select("id,quiz_id,student_id,attempt_number,results,score,total")
        .in("quiz_id", quizIds),
    ),
    unwrap<Array<{ attempt_id: string; question_id: string }>>(
      db.from("quiz_question_reviews").select("attempt_id,question_id"),
    ),
    unwrap<
      Array<{
        id: string;
        reporter_id: string;
        subject: string;
        status: string;
        admin_note: string | null;
      }>
    >(db.from("feedback_reports").select("id,reporter_id,subject,status,admin_note")),
  ]);
  const verifiedEssay =
    "first and second band gives the significant digits, the third band gives the multiplier, the fourth band gives the tolerance";
  const proposals: Array<{
    attemptId: string;
    questionId: string;
    reason: string;
    studentId: string;
  }> = [];
  for (const attempt of attempts)
    for (const r of attempt.results ?? []) {
      if (
        r.correct ||
        !r.chosen ||
        reviews.some((v) => v.attempt_id === attempt.id && v.question_id === r.id)
      )
        continue;
      const q = questions.find((q) => q.id === r.id);
      if (!q || q.options.length) continue;
      if (
        !q.correct_answer.startsWith("Rubric:") &&
        matchesIdentification(r.chosen, q.correct_answer)
      )
        proposals.push({
          attemptId: attempt.id,
          questionId: r.id,
          studentId: attempt.student_id,
          reason:
            "System maintenance: verified identification formatting/alias correction; original answer and integrity penalty preserved.",
        });
      else if (
        r.id === "602967b7-5383-4887-997d-6504dd2f186a" &&
        normalizeIdentification(r.chosen) === verifiedEssay &&
        gradeEssay(r.chosen, q.correct_answer.slice("Rubric:".length).trim())
      )
        proposals.push({
          attemptId: attempt.id,
          questionId: r.id,
          studentId: attempt.student_id,
          reason:
            "System maintenance: corrected false rejection of a complete four-band resistor explanation using the verb gives; all required rubric concepts are present.",
        });
    }
  const changes = proposals.map((p) => ({
    attemptId: p.attemptId,
    questionId: p.questionId,
    reason: p.reason,
  }));
  if (!apply) return { mode: "preview", changes, reportSubjects: reports.map((r) => r.subject) };
  for (const p of proposals) {
    const result = await db.rpc("review_attempt_question", {
      p_attempt: p.attemptId,
      p_question: p.questionId,
      p_correct: true,
      p_expected: false,
      p_reason: p.reason,
      p_actor: null,
    });
    if (result.error) throw new Error(`Repair stopped at ${p.attemptId}: ${result.error.message}`);
    await writeAuditLog(
      null,
      "Verified question repair",
      `Attempt ${p.attemptId} · question ${p.questionId} · ${p.reason}`,
    );
  }
  const now = new Date().toISOString();
  for (const report of reports) {
    if (report.admin_note?.includes(marker)) continue;
    let note: string | undefined,
      status = "in_review";
    if (report.id === "95b3cabf-88f2-467d-b18f-556eed08cf5f") {
      const attempt = attempts.find(
        (a) =>
          a.student_id === report.reporter_id &&
          a.quiz_id === "40b0a306-cdec-4587-9e84-e76706f26e2f",
      );
      if (attempt) {
        note =
          "Verified the saved four-band resistor explanation: it correctly identifies the first two significant digits, third-band multiplier and fourth-band tolerance. The checker falsely rejected the verb ‘gives’. The scoring regression is fixed and this answer has been corrected with an audit entry. Original response, penalties and highest-retake policy are preserved. Course grades were not published.";
        status = "resolved";
      }
    } else if (report.id === "34fb74c6-0de2-49c5-b173-d83eea71bdb3") {
      note =
        "Added conservative identification formatting normalization and verified light-intensity aliases, including ‘how bright it is’ and ‘light level’. Previously rejected exact equivalents were corrected with audit entries. Ambiguous answers are available for question-level teacher review with a reason; no fuzzy substring scoring is used. Teacher follow-up: review ‘Arduino Uno’ for the platform question and ‘light sensor’ for the pictured LDR before deciding whether these broader answers deserve credit. Course grades were not published.";
    } else if (report.id === "db5e0aae-0d32-43bc-b6a9-4e2cb9dd91db") {
      const exam = quizzes.find((q) => q.title === "1st Quarter Exam");
      if (exam) {
        // Idempotent recovery grant, deduplicated by the report marker and a recorded grant reason.
        const grant = await db.rpc("grant_report_recovery", {
          p_report: report.id,
          p_quiz: exam.id,
          p_student: report.reporter_id,
        });
        if (grant.error)
          throw new Error(
            "Could not grant the recovery attempt; retry maintenance after checking the report.",
          );
        note =
          "Worksheet and Arduino-editor Enter keys retain multiline editing; non-submit controls cannot implicitly submit a form. Arduino code/wiring and the submission retry key now survive reloads, and PWA updates wait for assessment completion. Startup fullscreen signals no longer count as exits. The historical attempt records a fullscreen-change event; it cannot establish that Enter itself caused the submission. One additional recovery attempt has been granted, preserving every original attempt and the IT10 highest score. Teacher follow-up: the original exam window is closed; schedule a recovery window before the student can use this grant.";
        await writeAuditLog(
          null,
          "Report recovery retake granted",
          `Report ${report.id} · worksheet ${exam.id} · one additional attempt`,
        );
      }
    }
    if (note)
      await unwrap(
        db
          .from("feedback_reports")
          .update({
            status,
            admin_note: `${marker} ${note}`,
            updated_at: now,
            ...(status === "resolved" ? { resolved_at: now } : {}),
          })
          .eq("id", report.id),
      );
  }
  return { mode: "applied", changes };
}
