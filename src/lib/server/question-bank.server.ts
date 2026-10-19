/* eslint-disable @typescript-eslint/no-explicit-any */
// Question bank — staff-facing view over quiz_questions with course context
// (the `question_bank` view), plus guarded in-place question editing.
// Includes answer keys, so every entry point is staff-only.
import { db } from "@/integrations/db/client.server";
import { unwrap, asJsonParam } from "@/lib/server/utils.server";
import { requireStaff } from "@/lib/server/auth.server";
import { isAssessmentEditable } from "@/lib/server/availability";
import { writeAuditLog } from "@/lib/server/audit.server";
import { labTaskWiringProblem } from "@/lib/server/schemas.server";

export interface QuestionBankRow {
  id: string;
  quiz_id: string;
  course_id: string;
  course_code: string | null;
  question: string;
  options: string[];
  correct_answer: string;
  position: number;
  image_url: string | null;
  lab_task: boolean;
  required: boolean;
  question_type: string | null;
  created_at: string;
  /** Worksheet context (question_bank view) — title/ordering/soft-delete state. */
  quiz_title: string | null;
  quiz_created_at: string | null;
  quiz_deleted_at: string | null;
}

export interface QuestionPatch {
  question?: string | undefined;
  options?: string[] | undefined;
  correct_answer?: string | undefined;
  lab_task?: boolean | undefined;
  required?: boolean | undefined;
  image_url?: string | null | undefined;
}

/** Defensive normalization (jsonb comes back parsed on both backends). */
function normalizeRow(r: any): QuestionBankRow {
  const options = typeof r.options === "string" ? safeParse(r.options) : r.options;
  return {
    ...(r as QuestionBankRow),
    options: Array.isArray(options) ? options : [],
    quiz_title: r.quiz_title ?? null,
    quiz_created_at: r.quiz_created_at ?? null,
    quiz_deleted_at: r.quiz_deleted_at ?? null,
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

/**
 * List question-bank rows, optionally scoped to one course (omit courseId for
 * everything). Staff-only — rows include the answer key.
 */
export async function listQuestionBank(
  token: string,
  opts: { courseId?: string | null } = {},
): Promise<QuestionBankRow[]> {
  await requireStaff(token);
  let q = db.from("question_bank").select("*");
  if (opts.courseId) q = q.eq("course_id", opts.courseId);
  const rows = await unwrap<any[]>(q.order("quiz_id").order("position"));
  return rows.map(normalizeRow);
}

/**
 * Edit one quiz question in place. Only the provided fields are written;
 * `options` is stored as jsonb via asJsonParam so it round-trips both
 * backends. Staff-only; writes an audit entry and returns the updated row as
 * seen through the question_bank view.
 */
export async function updateQuestion(
  token: string,
  id: string,
  patch: QuestionPatch,
): Promise<QuestionBankRow> {
  const caller = await requireStaff(token);

  // Live scoring-key lock: look up the question's quiz_id and the parent
  // worksheet's window; refuse edits while the scheduled window is open so the
  // answer key cannot change under in-progress attempts. Legacy always-open
  // worksheets (opens_at NULL) are never locked.
  const parent = await unwrap<any>(
    db.from("quiz_questions").select("quiz_id, question_type").eq("id", id).maybeSingle(),
  );
  if (!parent) throw new Error("Not found");
  if (
    patch.options !== undefined &&
    parent.question_type === "multiple_choice" &&
    patch.options.length !== 4
  ) {
    throw new Error("Multiple-choice questions must have exactly four options.");
  }
  const quiz = await unwrap<any>(
    db.from("quizzes").select("opens_at, closes_at").eq("id", parent.quiz_id).maybeSingle(),
  );
  if (quiz && !isAssessmentEditable(quiz, new Date())) {
    throw new Error(
      "This worksheet's scheduled window is open — question edits are locked until it closes.",
    );
  }

  const row: Record<string, any> = {};
  if (patch.question !== undefined) row["question"] = patch.question;
  if (patch.options !== undefined) row["options"] = asJsonParam(patch.options);
  if (patch.correct_answer !== undefined) row["correct_answer"] = patch.correct_answer;
  if (patch.lab_task !== undefined) row["lab_task"] = patch.lab_task;
  if (patch.required !== undefined) row["required"] = patch.required;
  if (patch.image_url !== undefined) row["image_url"] = patch.image_url;

  // Effective-state wiring check: a patch may omit lab_task while editing the
  // question text, so validate the merged row (post-update state), not just the
  // patch. Mirrors the Zod rule in schemas.server.ts; the DB trigger remains
  // the backstop (PR #56 review — defense-in-depth consistency).
  if (row["question"] !== undefined || row["lab_task"] !== undefined) {
    const current = await unwrap<any>(
      db.from("quiz_questions").select("question, lab_task").eq("id", id).maybeSingle(),
    );
    if (!current) throw new Error("Not found");
    const problem = labTaskWiringProblem({
      question: row["question"] !== undefined ? row["question"] : current.question,
      lab_task: row["lab_task"] !== undefined ? row["lab_task"] : current.lab_task,
    });
    if (problem) throw new Error(problem);
  }

  if (Object.keys(row).length > 0) {
    await unwrap(db.from("quiz_questions").update(row).eq("id", id));
  }

  const saved = await unwrap<any>(db.from("question_bank").select("*").eq("id", id).maybeSingle());
  if (!saved) throw new Error("Not found");

  await writeAuditLog(
    caller,
    "Question updated",
    `Question ${id} · ${Object.keys(row).join(", ") || "no fields"}`,
  );
  return normalizeRow(saved);
}
