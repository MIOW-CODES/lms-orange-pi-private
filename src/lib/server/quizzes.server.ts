import { matchesIdentification, matchesOption } from "@/lib/answer-matching";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Quizzes — CRUD, attempts, retake policy engine, essay grading, scoring.
import { z } from "zod";
import { db } from "@/integrations/db/client.server";
import {
  unwrap,
  withoutToken,
  isUniqueViolation,
  asJsonParam,
  allDatabaseRows,
} from "@/lib/server/utils.server";
import {
  requireTeacher,
  requireSession,
  requireStaff,
  requireEnrollment,
  enrolledCourseIds,
} from "@/lib/server/auth.server";
import { getProfileById } from "@/lib/server/profiles.server";
import {
  hasOpened,
  requireOpen,
  canViewAssessment,
  isAssessmentEditable,
  AvailabilityError,
} from "@/lib/server/availability";
import { schemas } from "@/lib/server/schemas.server";
import type { IntegrityEventType } from "@/lib/integrity";
import type { ProfileRole } from "@/lib/server/db-types";
import { dispatchNotification } from "@/lib/server/notifications.server";
import { writeAuditLog } from "@/lib/server/audit.server";

export async function listQuizzes(caller: { id: string; role: ProfileRole }) {
  const rows = await unwrap<any[]>(db.from("quizzes").select("*").is("deleted_at", null));
  // Staff (teacher/admin) see every course's rows; students only see items in
  // courses they are enrolled in AND that have opened (closed items stay
  // visible for review).
  if (caller.role !== "student") return rows;
  const enrolled = new Set(await enrolledCourseIds(caller.id));
  const now = new Date();
  return rows.filter((q) => enrolled.has(q.course_id) && canViewAssessment(q, caller.role, now));
}

/** In-place Fisher-Yates shuffle (uniform random permutation). */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Question-bank selection. Chooses `count` questions out of `all`, preferring
 * questions the student has NOT seen in prior attempts (so retakes surface fresh
 * items), then filling any remainder from the previously-seen pool when the bank
 * is exhausted. Both pools are shuffled so the presentation order also varies.
 *
 * Pure and exported for unit testing.
 */
export function selectQuestionBank<T extends { id: string; required?: boolean }>(
  all: T[],
  count: number,
  usedIds: Iterable<string>,
): T[] {
  if (count <= 0 || all.length <= count) return all;
  // Pinned items (e.g. a fixed exam section like Part I pictures or Part IV
  // problem solving) are never dropped from a draw: reserve their slots first,
  // then fill the remainder from the flexible pool with unseen-first order.
  const pinned = all.filter((q) => q.required);
  if (pinned.length >= count) return shuffleInPlace([...pinned]).slice(0, count);
  const pool = pinned.length ? all.filter((q) => !q.required) : all;
  const need = count - pinned.length;
  const used = new Set(usedIds);
  const unused: T[] = [];
  const seen: T[] = [];
  for (const q of pool) (used.has(q.id) ? seen : unused).push(q);
  shuffleInPlace(unused);
  shuffleInPlace(seen);
  return [...pinned, ...unused, ...seen].slice(0, need + pinned.length);
}

/**
 * Jumble a worksheet's presentation: shuffle the question order AND, within
 * each question, the answer options. Options are matched by TEXT during
 * scoring (`scoreQuiz` compares the chosen text to `correct_answer`), so
 * permuting them never changes correctness — it only removes positional bias
 * (e.g. a bank authored with the correct answer always at index 0, which would
 * otherwise always render as "letter A").
 *
 * Structured worksheets are respected: `required` questions (a fixed exam
 * section, e.g. Part I picture identification and the Part IV problem-solving
 * essays) keep their authored slots and relative order, so a jumble never
 * scatters a section into the middle of the multiple-choice body. Only the
 * flexible pool is shuffled.
 */
export function randomizeQuestions(questions: any[]): any[] {
  const flexSlots = questions.map((_, i) => i).filter((i) => !questions[i].required);
  const flexValues = shuffleInPlace(flexSlots.map((i) => questions[i]));
  const result = [...questions];
  flexSlots.forEach((slot, k) => {
    result[slot] = flexValues[k];
  });
  return result.map((q, i) => {
    const opts = Array.isArray(q.options) ? q.options : [];
    const options = opts.length > 1 ? shuffleInPlace([...opts]) : opts;
    return { ...q, options, position: i + 1 };
  });
}

export async function getQuizPublic(id: string, studentId?: string) {
  const quiz = await unwrap<any>(
    db.from("quizzes").select("*").eq("id", id).is("deleted_at", null).single(),
  );
  // Enforcement (user policy 2026-10-06): students must be enrolled in the
  // course and may only open the worksheet inside its availability window.
  // Staff (teacher/admin) bypass for grading/preview.
  if (studentId) {
    const profile = await getProfileById(studentId);
    if (!profile) throw new Error("Unauthorized");
    if (profile.role === "student") {
      await requireEnrollment(quiz.course_id, profile);
      const [attempts, extra] = await Promise.all([
        attemptsFor(id, profile.id),
        extraAttemptsFor(id, profile.id),
      ]);
      const ceiling = attemptCeiling(quiz, extra);
      if (ceiling != null && attempts.length >= ceiling) {
        throw new Error(
          "This worksheet has already been submitted. Ask your teacher to grant a retake.",
        );
      }
      requireOpen(quiz, new Date());
    }
  }
  let questions = await unwrap<any[]>(
    db
      .from("quiz_questions")
      .select(
        "id, quiz_id, question, options, position, image_url, lab_task, required, question_type",
      )
      .eq("quiz_id", id)
      .order("position"),
  );
  // Question bank: if question_count > 0, take a random subset that avoids
  // questions this student already answered in prior attempts when possible.
  const questionCount = quiz.question_count ?? 0;
  let selected = questions;
  if (questionCount > 0 && questions.length > questionCount) {
    let usedIds: string[] = [];
    if (studentId) {
      // A single indexed query for THIS student's prior attempts — not N+1.
      // Covered by idx_quiz_attempts_quiz_student (quiz_id, student_id).
      const prior = await unwrap<Array<{ question_ids: string[] | null }>>(
        db
          .from("quiz_attempts")
          .select("question_ids")
          .eq("quiz_id", id)
          .eq("student_id", studentId),
      );
      usedIds = prior.flatMap((a) => (Array.isArray(a.question_ids) ? a.question_ids : []));
    }
    selected = selectQuestionBank(questions, questionCount, usedIds);
  }
  // Restore the teacher's authored order before jumbling. `selectQuestionBank`
  // returns pinned questions first, which would drag a fixed end-section (e.g.
  // the Part IV problem-solving essays) up to the front of the paper. Re-sorting
  // by authored `position` lets randomizeQuestions keep every required item in
  // its real slot (Part I … Part IV last) while shuffling the flexible body.
  selected = [...selected].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  // Assessment integrity: ALWAYS jumble the presentation (question order and
  // per-question option order), not only when a subset is drawn. Without this a
  // full-length exam (question_count === bank size) renders in authored order
  // and, if the seed placed the correct option first, every answer is "A".
  questions = randomizeQuestions(selected);
  return { quiz, questions };
}

/* ---------- Essay auto-grading (strict) ---------- */

const ESSAY_MIN_WORDS = 5;

function essayWords(answer: string): string[] {
  return answer.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
}

function isGibberishAnswer(answer: string, words: string[]): boolean {
  if (words.length < ESSAY_MIN_WORDS) return true;
  const lower = answer.toLowerCase();
  if (/([a-z])\1{3,}/.test(lower)) return true;
  if (words.some((w) => w.length >= 5 && !/[aeiou]/.test(w))) return true;
  return false;
}

/** Reject keyword stuffing while allowing natural paraphrases around the key concepts. */
function isCoherentEssayAnswer(answer: string, words: string[]): boolean {
  const lower = answer.toLowerCase();
  // A readable response needs a predicate or explanatory connector; a bare
  // list of rubric terms should not receive credit just because it hits keys.
  const hasPredicate =
    /\b(is|are|was|were|be|being|been|means?|gives?|causes?|allows?|helps?|shows?|makes?|uses?|involves?|includes?|because|therefore|so|which|that|when|while|by|converts?|produces?|occurs?|undergoes?|replicates?|separates?|attaches?|moves?|forms?|provides?|creates?|prevents?|supports?|enables?|absorbs?|releases?|transfers?|depends?|results?|leads?)\b/i.test(
      lower,
    );
  if (!hasPredicate) return false;
  const uniqueWords = new Set(words);
  return uniqueWords.size >= 5;
}

function hasContextualExplanation(
  words: string[],
  rubric: string,
  categories: string[][],
): boolean {
  const terms = (categories.flat().length ? categories.flat() : rubricConcepts(rubric)).flatMap(
    (term) => term.split(/\s+/),
  );
  const isKeywordToken = (word: string) =>
    terms.some((term) => term.length > 2 && (word === term || word.startsWith(term)));
  const genericPredicates = new Set([
    "cause",
    "causes",
    "allow",
    "allows",
    "help",
    "helps",
    "show",
    "shows",
    "make",
    "makes",
    "use",
    "uses",
    "involve",
    "involves",
    "include",
    "includes",
  ]);
  const contextual = words.filter(
    (word) => !RUBRIC_STOPWORDS.has(word) && !genericPredicates.has(word) && !isKeywordToken(word),
  );
  const text = words.join(" ");
  const hasStrongPredicate =
    /\b(convert\w*|produce\w*|occur\w*|undergo\w*|replicate\w*|separate\w*|attach\w*|move\w*|form\w*|provide\w*|create\w*|prevent\w*|support\w*|enable\w*|absorb\w*|release\w*|transfer\w*|depend\w*|result\w*|lead\w*)\b/i.test(
      text,
    );
  const hasConnector =
    /\b(and|or|because|that|which|to|in|on|for|with|during|by|as|of|into)\b/i.test(text);
  return (
    new Set(contextual).size >= 2 || (contextual.length >= 1 && hasStrongPredicate && hasConnector)
  );
}

export function parseKeywordCategories(rubric: string): string[][] {
  const m = rubric.match(/\|\s*keywords?\s*:\s*(.+)$/i) ?? rubric.match(/^keywords?\s*:\s*(.+)$/i);
  if (!m) return [];
  return m[1]!
    .split(";")
    .map((group) =>
      group
        .replace(/^[^=;]*=\s*/, "")
        .split(/[,/|]/)
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
    )
    .filter((g) => g.length > 0);
}

const RUBRIC_STOPWORDS = new Set(
  (
    "the a an and or of to in on for with by is are was were be that this it its as at from their they them his her he she you your we our " +
    "not no but if then than so such into over under between about through during before after above below each other some any all both " +
    "more most less very can could should would may might must will shall do does did done pass fail requires require required full marks " +
    "credit answer answers response responses explanation identification identify coherent complete incomplete gibberish single word words " +
    "instantly elements element two one concept concepts specific technique demonstrates demonstrate shows show mention mentions"
  ).split(" "),
);

function rubricConcepts(rubric: string): string[] {
  const words = (rubric.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter(
    (w) => !RUBRIC_STOPWORDS.has(w),
  );
  return [...new Set(words)];
}

function keywordHit(answer: string, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return false;
  if (needle.includes(" ")) return answer.toLowerCase().includes(needle);
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`, "i").test(answer);
}

export function gradeEssay(answer: string, rubric: string): boolean {
  const words = essayWords(answer);
  if (isGibberishAnswer(answer, words) || !isCoherentEssayAnswer(answer, words)) return false;
  const categories = parseKeywordCategories(rubric);
  if (!hasContextualExplanation(words, rubric, categories)) return false;
  if (categories.length >= 2) {
    const hitCategories = categories.filter((cat) =>
      cat.some((kw) => keywordHit(answer, kw)),
    ).length;
    return hitCategories >= 2;
  }
  const concepts = categories[0] ?? rubricConcepts(rubric);
  return concepts.filter((kw) => keywordHit(answer, kw)).length >= 2;
}

/** One point is deducted for each recorded integrity event, up to raw score. */
export const INTEGRITY_PENALTY_PER_EVENT = 1;

export function applyIntegrityPenalty(
  rawScore: number,
  events: Array<{ type: string }>,
): { score: number; penalty: number } {
  const penalty = Math.min(Math.max(0, rawScore), events.length * INTEGRITY_PENALTY_PER_EVENT);
  return { score: Math.max(0, rawScore - penalty), penalty };
}

/* ---------- Scoring ---------- */

export type AttemptQuestionIdsValidation =
  { ok: true; questionIds: string[] | undefined } | { ok: false; error: string };

/**
 * Validate the client-supplied `question_ids` of an attempt before scoring.
 *
 * A submit may only score questions that belong to the worksheet
 * (`quiz_questions.quiz_id = quizId`), and for question-bank worksheets
 * (`question_count > 0`) the attempt must cover exactly the drawn set.
 *
 * Pure and exported for unit testing.
 */
export function validateAttemptQuestionIds(
  submittedIds: string[] | null | undefined,
  quizQuestionIds: Iterable<string>,
  questionCount: number,
): AttemptQuestionIdsValidation {
  const valid = new Set(quizQuestionIds);
  const provided = Array.isArray(submittedIds) ? submittedIds : undefined;
  const ids = provided ?? [];
  // Duplicates would inflate the attempt's question set without adding anything
  // to score — reject them outright.
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "Duplicate question ids in this attempt." };
  }
  const foreign = ids.filter((id) => !valid.has(id));
  if (foreign.length > 0) {
    return {
      ok: false,
      error: `This attempt includes ${foreign.length} question id(s) that are not part of this worksheet.`,
    };
  }
  if (questionCount > 0 && ids.length !== questionCount) {
    return {
      ok: false,
      error: `This worksheet scores exactly ${questionCount} question(s); the attempt sent ${ids.length} question id(s).`,
    };
  }
  return { ok: true, questionIds: provided };
}

async function scoreQuiz(quiz_id: string, answers: Record<string, string>, questionIds?: string[]) {
  let query = db
    .from("quiz_questions")
    .select("id, question, options, correct_answer, image_url")
    .eq("quiz_id", quiz_id)
    .order("position");
  // If question_ids provided (question bank), only score those questions
  if (questionIds && questionIds.length > 0) {
    query = query.in("id", questionIds);
  }
  const questions = await unwrap<
    Array<{
      id: string;
      question: string;
      options: unknown;
      correct_answer: string;
      image_url: string | null;
    }>
  >(query);
  const orderedQuestions = questionIds
    ? [...questions].sort((a, b) => questionIds.indexOf(a.id) - questionIds.indexOf(b.id))
    : questions;
  const results = orderedQuestions.map((q) => {
    const chosen = answers[q.id] ?? null;
    const options = (Array.isArray(q.options) ? q.options : []) as string[];
    const key = q.correct_answer as string;
    const isEssay = options.length === 0 && key.startsWith("Rubric:");
    const correct = isEssay
      ? !!chosen && gradeEssay(chosen, key.slice("Rubric:".length).trim())
      : chosen != null &&
        (options.length ? matchesOption(chosen, key) : matchesIdentification(chosen, key));
    return {
      id: q.id as string,
      question: q.question as string,
      options,
      chosen,
      correct_answer: key,
      correct,
      image_url: (q.image_url as string | null) ?? null,
    };
  });
  const score = results.filter((r) => r.correct).length;
  return { score, total: questions.length, results };
}

/* ---------- Retake policy engine ---------- */

type RetakePolicy = "highest_score" | "latest_attempt" | "average_score";

interface QuizConfig {
  id: string;
  course_id: string;
  title: string;
  allow_retake: boolean;
  max_attempts: number;
  retake_score_policy: RetakePolicy;
  score_released: boolean;
  answer_key_released: boolean;
  question_count: number;
  opens_at: string | null;
  closes_at: string | null;
}

const QUIZ_CONFIG_COLS =
  "id, course_id, title, allow_retake, max_attempts, retake_score_policy, score_released, answer_key_released, question_count, opens_at, closes_at";

async function getQuizConfig(quizId: string): Promise<QuizConfig> {
  const quiz = await unwrap<any>(
    db.from("quizzes").select(QUIZ_CONFIG_COLS).eq("id", quizId).maybeSingle(),
  );
  if (!quiz) throw new Error("Worksheet not found.");
  return quiz as QuizConfig;
}

async function attemptsFor(quizId: string, studentId: string) {
  return unwrap<
    Array<{ attempt_number: number; score: number; total: number; created_at: string }>
  >(
    db
      .from("quiz_attempts")
      .select("attempt_number, score, total, created_at")
      .eq("quiz_id", quizId)
      .eq("student_id", studentId)
      .order("attempt_number"),
  );
}

async function extraAttemptsFor(quizId: string, studentId: string): Promise<number> {
  const grant = await unwrap<any>(
    db
      .from("quiz_retake_grants")
      .select("extra_attempts")
      .eq("quiz_id", quizId)
      .eq("student_id", studentId)
      .maybeSingle(),
  );
  return typeof grant?.extra_attempts === "number" ? grant.extra_attempts : 0;
}

export function attemptCeiling(
  quiz: Pick<QuizConfig, "allow_retake" | "max_attempts">,
  extra: number,
): number | null {
  if (quiz.allow_retake && quiz.max_attempts === 0) return null;
  const base = quiz.allow_retake ? quiz.max_attempts : 1;
  return base + extra;
}

type AttemptRow = {
  attempt_number: number;
  score: number;
  total: number;
  tab_switches?: Array<{ at: number; type: string }>;
};

type ScoredResult = {
  id: string;
  question: string;
  options: string[];
  chosen: string | null;
  correct_answer: string;
  correct: boolean;
  image_url?: string | null;
};

export function effectiveScore(
  attempts: AttemptRow[],
  policy: RetakePolicy,
): { score: number; total: number } | null {
  if (!attempts.length) return null;
  const pct = (a: AttemptRow) => (a.total > 0 ? a.score / a.total : 0);
  if (policy === "latest_attempt") {
    const latest = attempts.reduce((a, b) => (b.attempt_number > a.attempt_number ? b : a));
    return { score: latest.score, total: latest.total };
  }
  if (policy === "average_score") {
    const total = attempts[0]!.total;
    const avg = attempts.reduce((s, a) => s + pct(a), 0) / attempts.length;
    return { score: Math.round(avg * total * 100) / 100, total };
  }
  const best = attempts.reduce((a, b) => (pct(b) > pct(a) ? b : a));
  return { score: best.score, total: best.total };
}

/**
 * Release gating for per-question attempt rows (pure, exported for testing).
 *
 * Two independent gates:
 *  - `scoreReleased`: until the teacher releases scores, NO per-question rows
 *    leave the server — that withholds every correctness flag along with them.
 *  - `answerKeyReleased`: once scores are released, review rows stay visible but
 *    the answer key itself is withheld (blanked) until it is released too.
 */
export function gateAttemptResults<T extends { correct_answer: string }>(
  results: T[],
  gating: { scoreReleased: boolean; answerKeyReleased: boolean },
): T[] {
  if (!gating.scoreReleased) return [];
  if (gating.answerKeyReleased) return results;
  return results.map((r) => ({ ...r, correct_answer: "" }));
}

/** Build the gated submit response shared by fresh inserts and idempotent replays. */
function gatedResponse(
  quiz: QuizConfig,
  attempt: { attempt_number: number; score: number; total: number },
  results: ScoredResult[],
  used: number,
  ceiling: number | null,
  attemptsIncludingThis: AttemptRow[],
) {
  const eff = effectiveScore(attemptsIncludingThis, quiz.retake_score_policy);
  const isScoreReleased = quiz.score_released === true;
  const isAnswerKeyReleased = quiz.answer_key_released === true;
  // Score-release gating is real: until scores are released the response carries
  // NO per-question rows (hence no correctness flags), no `total` and no score.
  // The answer key is gated separately on answer_key_released.
  const gatedResults = gateAttemptResults(results, {
    scoreReleased: isScoreReleased,
    answerKeyReleased: isAnswerKeyReleased,
  });
  return {
    ok: true as const,
    score: (isScoreReleased ? attempt.score : null) as number | null,
    total: (isScoreReleased ? attempt.total : null) as number | null,
    results: gatedResults,
    attempt_number: attempt.attempt_number,
    attempts_used: used,
    attempts_allowed: ceiling,
    can_retake: ceiling == null || used < ceiling,
    effective_score: (isScoreReleased ? (eff?.score ?? attempt.score) : null) as number | null,
    retake_score_policy: quiz.retake_score_policy,
    score_released: isScoreReleased,
    answer_key_released: isAnswerKeyReleased,
  };
}

/** Load a stored attempt (score/total/results) by an idempotency key. */
async function attemptBySubmissionId(studentId: string, submissionId: string) {
  return unwrap<{
    attempt_number: number;
    score: number;
    total: number;
    results: ScoredResult[] | null;
  } | null>(
    db
      .from("quiz_attempts")
      .select("attempt_number, score, total, results")
      .eq("student_id", studentId)
      .eq("submission_id", submissionId)
      .maybeSingle(),
  );
}

export async function submitQuizAttempt(
  quiz_id: string,
  answers: Record<string, string>,
  token: string,
  questionIds?: string[],
  tabSwitches?: Array<{ at: number; type: IntegrityEventType }>,
  submissionId?: string,
) {
  const caller = await requireSession(token);
  const quiz = await getQuizConfig(quiz_id);

  // Idempotency replay: a retry after a lost response (or a duplicate in-flight
  // request) reuses the same submission_id and returns the stored result
  // instead of recording another attempt.
  if (submissionId) {
    const existing = await attemptBySubmissionId(caller.id, submissionId);
    if (existing) {
      const [attempts, extra] = await Promise.all([
        attemptsFor(quiz_id, caller.id),
        extraAttemptsFor(quiz_id, caller.id),
      ]);
      return gatedResponse(
        quiz,
        existing,
        Array.isArray(existing.results) ? existing.results : [],
        Math.max(attempts.length, existing.attempt_number),
        attemptCeiling(quiz, extra),
        attempts,
      );
    }
  }

  // Hard-block before/after the availability window (user policy 2026-10-06):
  // no new attempts before opens_at or after closes_at — no late flag, no
  // overwrite. Idempotent replays above are reads of an already-recorded
  // attempt and are never gated. Staff bypass for grading/preview.
  if (caller.role === "student") {
    await requireEnrollment(quiz.course_id, caller);
    requireOpen(quiz, new Date());
  }

  const [attempts, extra] = await Promise.all([
    attemptsFor(quiz_id, caller.id),
    extraAttemptsFor(quiz_id, caller.id),
  ]);
  const ceiling = attemptCeiling(quiz, extra);
  if (ceiling != null && attempts.length >= ceiling) {
    return {
      ok: false as const,
      reason: (!quiz.allow_retake && extra === 0 ? "retakes_disabled" : "max_attempts") as
        "retakes_disabled" | "max_attempts",
      attempts_used: attempts.length,
      attempts_allowed: ceiling,
    };
  }

  // M1: the client-supplied question set must belong to this worksheet (and
  // match the drawn size for question-bank worksheets) before it is scored.
  const quizQuestionRows = await unwrap<Array<{ id: string }>>(
    db.from("quiz_questions").select("id").eq("quiz_id", quiz_id),
  );
  const validated = validateAttemptQuestionIds(
    questionIds,
    quizQuestionRows.map((q) => q.id),
    quiz.question_count ?? 0,
  );
  if (!validated.ok) throw new Error(validated.error);

  // questionIds passed from client for question bank scoring
  const scored = await scoreQuiz(quiz_id, answers, validated.questionIds);
  const integrity = applyIntegrityPenalty(scored.score, tabSwitches ?? []);
  const { total, results } = scored;
  const attempt_number = attempts.reduce((m, a) => Math.max(m, a.attempt_number), 0) + 1;

  const row: Record<string, unknown> = {
    quiz_id,
    student_id: caller.id,
    attempt_number,
    score: integrity.score,
    total,
    // `results` and `tab_switches` are jsonb columns — wrap the JS arrays.
    // `question_ids` is a native uuid[] column and stays a plain array.
    results: asJsonParam(results),
    question_ids: validated.questionIds ?? [],
    tab_switches: asJsonParam(tabSwitches ?? []),
    raw_score: scored.score,
    integrity_penalty: integrity.penalty,
  };
  if (submissionId) row["submission_id"] = submissionId;

  // Idempotent insert: a concurrent double-submit collides on the unique
  // (quiz_id, student_id, attempt_number) index and is ignored.
  let inserted: Array<{ id: string }>;
  try {
    inserted = await unwrap<Array<{ id: string }>>(
      db
        .from("quiz_attempts")
        .upsert(row, {
          onConflict: "quiz_id,student_id,attempt_number",
          ignoreDuplicates: true,
        })
        .select("id"),
    );
  } catch (e) {
    // A racing identical submit may collide on the submission_id unique index
    // instead (upsert only ignores the declared conflict target).
    if (isUniqueViolation(e) && submissionId) {
      const existing = await attemptBySubmissionId(caller.id, submissionId);
      if (existing) {
        const fresh = await attemptsFor(quiz_id, caller.id);
        return gatedResponse(
          quiz,
          existing,
          Array.isArray(existing.results) ? existing.results : [],
          Math.max(fresh.length, existing.attempt_number),
          ceiling,
          fresh,
        );
      }
    }
    throw e;
  }

  // The insert was ignored because a submission with this id already existed.
  if ((!inserted || inserted.length === 0) && submissionId) {
    const existing = await attemptBySubmissionId(caller.id, submissionId);
    if (existing) {
      const fresh = await attemptsFor(quiz_id, caller.id);
      return gatedResponse(
        quiz,
        existing,
        Array.isArray(existing.results) ? existing.results : [],
        Math.max(fresh.length, existing.attempt_number),
        ceiling,
        fresh,
      );
    }
  }

  const used = attempts.length + 1;
  return gatedResponse(
    quiz,
    { attempt_number, score: integrity.score, total },
    results,
    used,
    ceiling,
    [...attempts, { attempt_number, score: integrity.score, total }],
  );
}

export async function quizAttemptInfo(quiz_id: string, token: string) {
  const caller = await requireSession(token);
  const quiz = await getQuizConfig(quiz_id);
  // Students must be enrolled and cannot probe not-yet-open worksheets. Closed
  // worksheets stay readable so scores remain reviewable; staff bypass.
  if (caller.role === "student") {
    await requireEnrollment(quiz.course_id, caller);
    if (!hasOpened(quiz, new Date())) throw new AvailabilityError("not_yet_open");
  }
  const [attempts, extra] = await Promise.all([
    attemptsFor(quiz_id, caller.id),
    extraAttemptsFor(quiz_id, caller.id),
  ]);
  const ceiling = attemptCeiling(quiz, extra);
  const eff = effectiveScore(attempts, quiz.retake_score_policy);
  const isScoreReleased = quiz.score_released === true;
  return {
    quiz_id,
    allow_retake: quiz.allow_retake,
    max_attempts: quiz.max_attempts,
    retake_score_policy: quiz.retake_score_policy,
    attempts_used: attempts.length,
    attempts_allowed: ceiling,
    can_retake: attempts.length === 0 || ceiling == null || attempts.length < ceiling,
    effective_score: isScoreReleased ? (eff?.score ?? null) : null,
    effective_total: isScoreReleased ? (eff?.total ?? null) : null,
    extra_attempts: extra,
    score_released: isScoreReleased,
    answer_key_released: quiz.answer_key_released === true,
  };
}

export async function listMyQuizSummaries(token: string) {
  const caller = await requireSession(token);
  const [attempts, grants, quizzes, retakeRequests] = await Promise.all([
    unwrap<any[]>(
      db
        .from("quiz_attempts")
        .select("quiz_id, attempt_number, score, total")
        .eq("student_id", caller.id),
    ),
    unwrap<any[]>(
      db.from("quiz_retake_grants").select("quiz_id, extra_attempts").eq("student_id", caller.id),
    ),
    unwrap<any[]>(db.from("quizzes").select(QUIZ_CONFIG_COLS).is("deleted_at", null)),
    unwrap<any[]>(
      db
        .from("quiz_retake_requests")
        .select("quiz_id, status, requested_at")
        .eq("student_id", caller.id)
        .order("requested_at", { ascending: false }),
    ),
  ]);
  // Students see summaries for enrolled courses' worksheets (same
  // scoping rule as listQuizzes); staff see everything.
  let visibleQuizzes = (quizzes ?? []) as Array<QuizConfig & { course_id: string }>;
  if (caller.role === "student") {
    const enrolled = new Set(await enrolledCourseIds(caller.id));
    visibleQuizzes = visibleQuizzes.filter((q) => enrolled.has(q.course_id));
  }
  const configById = new Map<string, QuizConfig>(
    visibleQuizzes.map((q: any) => [q.id as string, q as QuizConfig]),
  );
  const extraByQuiz = new Map<string, number>(
    (grants ?? []).map((g: any) => [g.quiz_id as string, (g.extra_attempts as number) ?? 0]),
  );
  const requestStatusByQuiz = new Map<string, "pending" | "approved" | "denied">();
  for (const request of retakeRequests ?? []) {
    if (!requestStatusByQuiz.has(request.quiz_id)) {
      requestStatusByQuiz.set(request.quiz_id, request.status);
    }
  }
  const byQuiz = new Map<string, AttemptRow[]>();
  for (const a of attempts ?? []) {
    const arr = byQuiz.get(a.quiz_id) ?? [];
    arr.push({ attempt_number: a.attempt_number, score: a.score, total: a.total });
    byQuiz.set(a.quiz_id, arr);
  }
  return [...configById.values()].map((quiz) => {
    const list = byQuiz.get(quiz.id) ?? [];
    const ceiling = attemptCeiling(quiz, extraByQuiz.get(quiz.id) ?? 0);
    const eff = effectiveScore(list, quiz.retake_score_policy);
    const isScoreReleased = (quiz as QuizConfig).score_released === true;
    return {
      quiz_id: quiz.id,
      attempts_used: list.length,
      attempts_allowed: ceiling,
      can_retake: list.length === 0 || ceiling == null || list.length < ceiling,
      effective_score: isScoreReleased ? (eff?.score ?? null) : null,
      effective_total: isScoreReleased ? (eff?.total ?? null) : null,
      score_released: isScoreReleased,
      answer_key_released: (quiz as QuizConfig).answer_key_released === true,
      retake_request_status: requestStatusByQuiz.get(quiz.id) ?? null,
    };
  });
}

/** A student requests one additional attempt after reaching the configured limit. */
export async function requestQuizRetake(quiz_id: string, token: string) {
  const caller = await requireSession(token);
  if (caller.role !== "student") throw new Error("Only students can request a retake.");
  const quiz = await getQuizConfig(quiz_id);
  await requireEnrollment(quiz.course_id, caller);
  requireOpen(quiz, new Date());
  const [attempts, extra] = await Promise.all([
    attemptsFor(quiz_id, caller.id),
    extraAttemptsFor(quiz_id, caller.id),
  ]);
  const ceiling = attemptCeiling(quiz, extra);
  if (ceiling == null || attempts.length < ceiling) {
    throw new Error("You still have an available attempt for this worksheet.");
  }
  const existing = await unwrap<any>(
    db
      .from("quiz_retake_requests")
      .select("id")
      .eq("quiz_id", quiz_id)
      .eq("student_id", caller.id)
      .eq("status", "pending")
      .maybeSingle(),
  );
  if (existing) return { status: "pending" as const };
  try {
    await unwrap(db.from("quiz_retake_requests").insert({ quiz_id, student_id: caller.id }));
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "pending" as const };
    throw error;
  }
  return { status: "pending" as const };
}

export async function listQuizRetakeRequests(quiz_id: string, token: string) {
  await requireQuizOwnerOrAdmin(token, quiz_id);
  const requests = await unwrap<any[]>(
    db
      .from("quiz_retake_requests")
      .select("id, quiz_id, student_id, status, requested_at")
      .eq("quiz_id", quiz_id)
      .eq("status", "pending")
      .order("requested_at", { ascending: true }),
  );
  if (!requests.length) return [];
  const students = await unwrap<any[]>(
    db
      .from("profiles")
      .select("id, full_name, student_id, section")
      .in(
        "id",
        requests.map((request) => request.student_id),
      ),
  );
  const byId = new Map(
    students.map((student) => [student.id, { ...student, student_no: student.student_id ?? null }]),
  );
  return requests.map((request) => ({
    ...request,
    student: byId.get(request.student_id) ?? null,
  }));
}

export async function reviewQuizRetakeRequest(
  request_id: string,
  decision: "approved" | "denied",
  token: string,
) {
  const caller = await requireSession(token);
  const request = await unwrap<any>(
    db.from("quiz_retake_requests").select("*").eq("id", request_id).single(),
  );
  await requireQuizOwnerOrAdmin(token, request.quiz_id);
  if (request.status !== "pending") throw new Error("This retake request was already reviewed.");
  const updated = await unwrap<any>(
    db
      .from("quiz_retake_requests")
      .update({ status: decision, reviewed_at: new Date().toISOString(), reviewed_by: caller.id })
      .eq("id", request_id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle(),
  );
  if (!updated) throw new Error("This retake request was already reviewed.");
  const [quiz, student] = await Promise.all([
    getQuizConfig(request.quiz_id),
    getProfileById(request.student_id),
  ]);
  await writeAuditLog(
    caller,
    `quiz.retake_request.${decision}`,
    `${decision === "approved" ? "Approved" : "Denied"} retake request for ${student?.full_name ?? request.student_id} on worksheet "${quiz.title}".`,
  );
  return { status: decision };
}

export async function requireQuizOwnerOrAdmin(token: string, quizId: string) {
  const caller = await requireStaff(token);
  if (caller.role === "teacher") {
    const quiz = await getQuizConfig(quizId);
    const course = await unwrap<any>(
      db.from("courses").select("teacher_id").eq("id", quiz.course_id).maybeSingle(),
    );
    if (!course || course.teacher_id !== caller.id) {
      throw new Error("Forbidden: you can only manage worksheets for your own courses.");
    }
  }
  return caller;
}

export async function updateQuizRetakePolicy(
  id: string,
  patch: { allow_retake: boolean; max_attempts: number; retake_score_policy: RetakePolicy },
  token: string,
) {
  await requireQuizOwnerOrAdmin(token, id);
  const config = await getQuizConfig(id);
  if (!isAssessmentEditable(config, new Date())) {
    throw new Error(
      "This worksheet is locked while its scheduled assessment window is active. Retake policy cannot be changed now.",
    );
  }
  await unwrap(db.from("quizzes").update(patch).eq("id", id));
}

export async function listQuizAttemptsForQuiz(quiz_id: string, token: string) {
  await requireQuizOwnerOrAdmin(token, quiz_id);
  const quiz = await getQuizConfig(quiz_id);
  const [attempts, grants, overrides] = await Promise.all([
    unwrap<any[]>(
      db
        .from("quiz_attempts")
        .select("student_id, attempt_number, score, total, created_at, tab_switches")
        .eq("quiz_id", quiz_id)
        .order("attempt_number"),
    ),
    unwrap<any[]>(
      db.from("quiz_retake_grants").select("student_id, extra_attempts").eq("quiz_id", quiz_id),
    ),
    unwrap<any[]>(
      db
        .from("quiz_score_overrides")
        .select("student_id, score, total, notes")
        .eq("quiz_id", quiz_id),
    ),
  ]);
  const studentIds = [...new Set<string>((attempts ?? []).map((a: any) => a.student_id as string))];
  // Include students who have an override but no attempts (manual entry).
  for (const o of overrides ?? []) {
    if (!studentIds.includes(o.student_id as string)) studentIds.push(o.student_id as string);
  }
  const profiles = studentIds.length
    ? await unwrap<any[]>(
        db.from("profiles").select("id, full_name, student_id, section").in("id", studentIds),
      )
    : [];
  const nameOf = new Map<string, any>((profiles ?? []).map((p: any) => [p.id as string, p]));
  const extraOf = new Map<string, number>(
    (grants ?? []).map((g: any) => [g.student_id as string, (g.extra_attempts as number) ?? 0]),
  );
  const overrideOf = new Map<string, any>(
    (overrides ?? []).map((o: any) => [o.student_id as string, o]),
  );
  const byStudent = new Map<string, AttemptRow[]>();
  for (const a of attempts ?? []) {
    const arr = byStudent.get(a.student_id) ?? [];
    arr.push({
      attempt_number: a.attempt_number,
      score: a.score,
      total: a.total,
      tab_switches: Array.isArray(a.tab_switches) ? a.tab_switches : [],
    });
    byStudent.set(a.student_id, arr);
  }
  const students = studentIds.map((sid) => {
    const list = byStudent.get(sid) ?? [];
    const eff = effectiveScore(list, quiz.retake_score_policy);
    const ov = overrideOf.get(sid);
    const p = nameOf.get(sid);
    // A teacher override supersedes the computed effective score.
    const overrideScore = ov?.score != null ? (ov.score as number) : null;
    const overrideTotal = ov?.total != null ? (ov.total as number) : null;
    return {
      student_id: sid,
      full_name: p?.full_name ?? "Unknown student",
      student_no: p?.student_id ?? null,
      section: p?.section ?? null,
      attempts: list,
      attempts_used: list.length,
      extra_attempts: extraOf.get(sid) ?? 0,
      effective_score: overrideScore ?? eff?.score ?? null,
      effective_total: overrideTotal ?? eff?.total ?? null,
      override_score: overrideScore,
      override_total: overrideTotal,
      override_notes: (ov?.notes as string | null) ?? null,
    };
  });
  return {
    quiz: {
      id: quiz.id,
      title: quiz.title,
      course_id: quiz.course_id,
      allow_retake: quiz.allow_retake,
      max_attempts: quiz.max_attempts,
      retake_score_policy: quiz.retake_score_policy,
    },
    students,
  };
}

/**
 * Teacher manual override of a student's effective worksheet score. The raw
 * AI attempt rows are preserved; the override is applied on top so it can be
 * revised or cleared without losing history.
 */
export async function overrideQuizAttempt(
  quiz_id: string,
  student_id: string,
  score: number | null,
  total: number | null,
  notes: string | null,
  token: string,
) {
  const caller = await requireQuizOwnerOrAdmin(token, quiz_id);
  if (!notes?.trim()) throw new Error("Enter a reason for changing this score.");
  if (score != null && total != null && score > total)
    throw new Error("Score cannot exceed the maximum.");
  const existing = await unwrap<any>(
    db
      .from("quiz_score_overrides")
      .select("id")
      .eq("quiz_id", quiz_id)
      .eq("student_id", student_id)
      .maybeSingle(),
  );
  // If a score is given without a total, default the total to the student's
  // latest attempt total so the override reads as a proper fraction instead of
  // "score/—". A null score (with null total) clears the override.
  let resolvedTotal = total;
  if (score != null && resolvedTotal == null) {
    const rows = await unwrap<any[]>(
      db
        .from("quiz_attempts")
        .select("attempt_number, total")
        .eq("quiz_id", quiz_id)
        .eq("student_id", student_id),
    );
    if (rows.length) {
      const latest = rows.reduce((a, b) => (b.attempt_number > a.attempt_number ? b : a));
      resolvedTotal = (latest.total as number | null) ?? null;
    }
  }
  const payload = {
    quiz_id,
    student_id,
    score,
    total: resolvedTotal,
    notes,
    overridden_by: caller.id,
    updated_at: new Date().toISOString(),
  };
  if (existing) await unwrap(db.from("quiz_score_overrides").update(payload).eq("id", existing.id));
  else await unwrap(db.from("quiz_score_overrides").insert(payload));
}

/** Full attempt detail incl. per-question results for one student. */
export async function listStudentAttemptDetail(quiz_id: string, student_id: string, token: string) {
  await requireQuizOwnerOrAdmin(token, quiz_id);
  const [quiz, profile, attempts, override] = await Promise.all([
    unwrap<any>(db.from("quizzes").select("id, title").eq("id", quiz_id).maybeSingle()),
    unwrap<any>(
      db
        .from("profiles")
        .select("id, full_name, student_id, section")
        .eq("id", student_id)
        .maybeSingle(),
    ),
    unwrap<any[]>(
      db
        .from("quiz_attempts")
        .select(
          "id, attempt_number, score, raw_score, integrity_penalty, total, created_at, results, tab_switches",
        )
        .eq("quiz_id", quiz_id)
        .eq("student_id", student_id)
        .order("attempt_number"),
    ),
    unwrap<any>(
      db
        .from("quiz_score_overrides")
        .select("score, total, notes")
        .eq("quiz_id", quiz_id)
        .eq("student_id", student_id)
        .maybeSingle(),
    ),
  ]);
  return {
    quiz: { id: quiz?.id ?? quiz_id, title: quiz?.title ?? "Worksheet" },
    student: {
      id: student_id,
      full_name: profile?.full_name ?? "Unknown student",
      student_no: profile?.student_id ?? null,
      section: profile?.section ?? null,
    },
    attempts: (attempts ?? []).map((a: any) => ({
      id: a.id as string,
      attempt_number: a.attempt_number as number,
      score: a.score as number,
      raw_score: (a.raw_score as number | null) ?? (a.score as number),
      integrity_penalty: (a.integrity_penalty as number | null) ?? 0,
      total: a.total as number,
      created_at: (a.created_at as string) ?? "",
      results: Array.isArray(a.results) ? a.results : [],
      tab_switches: Array.isArray(a.tab_switches) ? a.tab_switches : [],
    })),
    override: override
      ? {
          score: (override.score as number | null) ?? null,
          total: (override.total as number | null) ?? null,
          notes: (override.notes as string | null) ?? null,
        }
      : null,
  };
}

export async function grantQuizRetake(quiz_id: string, student_id: string, token: string) {
  const caller = await requireQuizOwnerOrAdmin(token, quiz_id);
  const [quiz, attempts] = await Promise.all([
    getQuizConfig(quiz_id),
    attemptsFor(quiz_id, student_id),
  ]);
  const existing = await unwrap<any>(
    db
      .from("quiz_retake_grants")
      .select("id, extra_attempts")
      .eq("quiz_id", quiz_id)
      .eq("student_id", student_id)
      .maybeSingle(),
  );
  // A student may already have several historical attempts from the old
  // unlimited policy. Permission must unlock one new attempt from that count.
  const base = quiz.allow_retake ? quiz.max_attempts : 1;
  const extraAttempts = Math.max((existing?.extra_attempts ?? 0) + 1, attempts.length + 1 - base);
  if (existing) {
    await unwrap(
      db
        .from("quiz_retake_grants")
        .update({ extra_attempts: extraAttempts, granted_by: caller.id })
        .eq("id", existing.id),
    );
  } else {
    await unwrap(
      db
        .from("quiz_retake_grants")
        .insert({ quiz_id, student_id, extra_attempts: extraAttempts, granted_by: caller.id }),
    );
  }
  const student = await getProfileById(student_id);
  await writeAuditLog(
    caller,
    "quiz.retake.granted",
    `Granted one additional attempt for worksheet "${quiz.title}" to ${student?.full_name ?? student_id}. Total approved extra attempts: ${extraAttempts}.`,
  );
}

export async function resetQuizAttempts(quiz_id: string, student_id: string, token: string) {
  const caller = await requireQuizOwnerOrAdmin(token, quiz_id);
  const [quiz, student, attempts, grant] = await Promise.all([
    getQuizConfig(quiz_id),
    getProfileById(student_id),
    attemptsFor(quiz_id, student_id),
    unwrap<any>(
      db
        .from("quiz_retake_grants")
        .select("extra_attempts")
        .eq("quiz_id", quiz_id)
        .eq("student_id", student_id)
        .maybeSingle(),
    ),
  ]);
  await unwrap(
    db.from("quiz_attempts").delete().eq("quiz_id", quiz_id).eq("student_id", student_id),
  );
  await unwrap(
    db.from("quiz_retake_grants").delete().eq("quiz_id", quiz_id).eq("student_id", student_id),
  );
  await writeAuditLog(
    caller,
    "quiz.attempts.reset",
    `Reset ${attempts.length} attempt(s) and removed ${grant?.extra_attempts ?? 0} retake grant(s) for ${student?.full_name ?? student_id} on worksheet "${quiz.title}".`,
  );
}

export async function createQuizWithQuestions(
  quiz: z.infer<typeof schemas.quizBundle>["quiz"],
  questions: z.infer<typeof schemas.quizBundle>["questions"],
) {
  // `attachments` (quizzes) and `options` (quiz_questions) are jsonb columns —
  // wrap JS arrays in asJsonParam so node-pg doesn't send a Postgres array
  // literal (see utils.server.ts).
  const quizRow: Record<string, unknown> = { ...quiz };
  if (Array.isArray(quizRow["attachments"]))
    quizRow["attachments"] = asJsonParam(quizRow["attachments"]);
  const created = await unwrap<any>(db.from("quizzes").insert(quizRow).select().single());
  await unwrap(
    db.from("quiz_questions").insert(
      questions.map((q, i) => ({
        ...q,
        options: asJsonParam(q.options),
        quiz_id: created.id,
        position: i + 1,
      })),
    ),
  );

  // Notify enrolled students via email and SMS
  void dispatchNotification({
    type: "quiz",
    title: quiz.title ?? "New Assessment",
    body: (quiz as any).description
      ? (quiz as any).description.slice(0, 150)
      : "A new quiz/worksheet is now available.",
    course_id: quiz.course_id,
  }).catch((err) => {
    console.error("[quizzes] Failed to dispatch notifications:", err);
  });
}

/** List all quiz scores for a course — used by the gradebook. */
export async function listQuizScoresForCourse(course_id: string, token: string) {
  await requireStaff(token);
  const quizzes = await unwrap<any[]>(
    db
      .from("quizzes")
      .select("id, title, retake_score_policy")
      .eq("course_id", course_id)
      .is("deleted_at", null),
  );
  if (!quizzes.length) return [];

  const quizIds = quizzes.map((q) => q.id);
  const [attempts, overrides] = await Promise.all([
    allDatabaseRows<any>((from, to) =>
      db
        .from("quiz_attempts")
        .select("quiz_id, student_id, attempt_number, score, total")
        .in("quiz_id", quizIds)
        .order("id")
        .range(from, to),
    ),
    allDatabaseRows<any>((from, to) =>
      db
        .from("quiz_score_overrides")
        .select("quiz_id, student_id, score, total")
        .in("quiz_id", quizIds)
        .order("id")
        .range(from, to),
    ),
  ]);

  const byQuizStudent = new Map<string, Map<string, AttemptRow[]>>();
  for (const q of quizzes) {
    byQuizStudent.set(q.id, new Map());
  }
  for (const a of attempts) {
    const studentMap = byQuizStudent.get(a.quiz_id);
    if (!studentMap) continue;
    const arr = studentMap.get(a.student_id) ?? [];
    arr.push({ attempt_number: a.attempt_number, score: a.score, total: a.total });
    studentMap.set(a.student_id, arr);
  }

  // Teacher overrides keyed by quiz → student. If an override carries a score
  // but no total (possible when it was written before attempts existed), resolve
  // the total from the student's latest attempt — mirroring overrideQuizAttempt.
  const overrideMap = new Map<string, Map<string, { score: number; total: number }>>();
  for (const o of overrides) {
    if (o.score == null) continue;
    let total = o.total as number | null;
    if (total == null) {
      const attempts = byQuizStudent.get(o.quiz_id)?.get(o.student_id) ?? [];
      if (attempts.length) {
        total = attempts.reduce((a, b) => (b.attempt_number > a.attempt_number ? b : a)).total;
      }
    }
    if (total == null) continue;
    const m = overrideMap.get(o.quiz_id) ?? new Map();
    m.set(o.student_id, { score: o.score as number, total });
    overrideMap.set(o.quiz_id, m);
  }

  return quizzes.map((q) => {
    const studentMap = byQuizStudent.get(q.id)!;
    const scores: Record<string, { score: number; total: number }> = {};
    for (const [sid, attemptList] of studentMap) {
      const eff = effectiveScore(attemptList, q.retake_score_policy);
      if (eff) scores[sid] = eff;
    }
    // Overrides always win over computed scores.
    for (const [sid, ov] of overrideMap.get(q.id) ?? []) scores[sid] = ov;
    return {
      quiz_id: q.id,
      title: q.title,
      scores,
    };
  });
}

const ALLOWED_QUIZ_COLUMNS = new Set([
  "title",
  "description",
  "course_id",
  "duration_minutes",
  "allow_retake",
  "max_attempts",
  "retake_score_policy",
  "score_released",
  "answer_key_released",
  "question_count",
  "attachments",
  "opens_at",
  "closes_at",
  "deleted_at",
]);

export async function updateQuiz(
  tokenStr: string,
  id: string,
  patch: Record<string, unknown>,
  questions?: Array<{ question: string; options: string[]; correct_answer: string }>,
) {
  await requireQuizOwnerOrAdmin(tokenStr, id);
  // Replacing questions wipes every attempt and rewrites the live answer key,
  // so it is locked while a scheduled window is open. Config-only patches
  // (release flags, retake policy, …) stay allowed, and legacy always-open
  // worksheets (opens_at NULL) are never locked.
  if (questions && questions.length) {
    const config = await getQuizConfig(id);
    if (!isAssessmentEditable(config, new Date())) {
      throw new Error(
        "This worksheet's scheduled window is open — question edits are locked until it closes.",
      );
    }
  }
  const safePatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => ALLOWED_QUIZ_COLUMNS.has(key)),
  );
  // `attachments` is jsonb — wrap the JS array (see utils.server.ts).
  if (Array.isArray(safePatch["attachments"]))
    safePatch["attachments"] = asJsonParam(safePatch["attachments"]);
  if (Object.keys(safePatch).length)
    await unwrap(db.from("quizzes").update(safePatch).eq("id", id));
  if (questions && questions.length) {
    await unwrap(db.from("quiz_attempts").delete().eq("quiz_id", id));
    await unwrap(db.from("quiz_questions").delete().eq("quiz_id", id));
    await unwrap(
      db.from("quiz_questions").insert(
        questions.map((q, i) => ({
          ...q,
          options: asJsonParam(q.options),
          quiz_id: id,
          position: i + 1,
        })),
      ),
    );
  }
}

export async function deleteQuiz(tokenStr: string, id: string, mode: "soft" | "hard") {
  await requireQuizOwnerOrAdmin(tokenStr, id);
  const row = await unwrap<any>(
    db.from("quizzes").select("attachments, opens_at, closes_at").eq("id", id).maybeSingle(),
  );
  // Deleting mid-exam wipes attempts and pulls the worksheet out from under
  // in-progress takers — locked while a scheduled window is open (legacy
  // always-open worksheets are never locked).
  if (row && !isAssessmentEditable(row, new Date())) {
    throw new Error(
      "This worksheet's scheduled window is open — deletion is locked until it closes.",
    );
  }
  if (mode === "soft") {
    await unwrap(db.from("quizzes").update({ deleted_at: new Date().toISOString() }).eq("id", id));
    return { mode };
  }
  await unwrap(db.from("quiz_attempts").delete().eq("quiz_id", id));
  await unwrap(db.from("quiz_retake_grants").delete().eq("quiz_id", id));
  await unwrap(db.from("quiz_questions").delete().eq("quiz_id", id));
  await unwrap(db.from("quizzes").delete().eq("id", id));
  // Best-effort removal of binary objects
  const attachments = Array.isArray(row?.attachments)
    ? (row.attachments as Array<{ path?: string }>)
    : [];
  const paths = attachments
    .map((a) => a.path)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (paths.length) {
    try {
      const { storage } = await import("@/integrations/db/client.server");
      const { error } = await storage.from("course-materials").remove(paths);
      if (error) throw new Error(`Storage cleanup failed: ${error.message}`);
    } catch {
      /* best-effort */
    }
  }
  return { mode };
}

/** Explicit, audited teacher decisions; corrections never republish course grades. */
export async function reviewAttemptQuestion(input: z.infer<typeof schemas.questionReview>) {
  await requireTeacher(input.token);
  const caller = await requireQuizOwnerOrAdmin(input.token, input.quizId);
  const attempt = await unwrap<{ quiz_id: string; student_id: string }>(
    db.from("quiz_attempts").select("quiz_id,student_id").eq("id", input.attemptId).single(),
  );
  if (attempt.quiz_id !== input.quizId)
    throw new Error("Attempt does not belong to this worksheet.");
  const response = await db.rpc("review_attempt_question", {
    p_attempt: input.attemptId,
    p_question: input.questionId,
    p_correct: input.correct,
    p_expected: input.expected,
    p_reason: input.reason,
    p_actor: caller.id,
  });
  if (response.error)
    throw new Error(
      response.error.message?.includes("already reviewed")
        ? "This answer was already reviewed. Reload before applying."
        : "Could not review this answer.",
    );
  await writeAuditLog(
    caller,
    "Question grade reviewed",
    `Attempt ${input.attemptId} · question ${input.questionId} · ${input.expected} → ${input.correct} · ${input.reason}`,
  );
}
export async function previewIdentificationRegrade(
  input: z.infer<typeof schemas.regradeIdentification>,
) {
  await requireQuizOwnerOrAdmin(input.token, input.quizId);
  const [questions, attempts] = await Promise.all([
    unwrap<Array<{ id: string; correct_answer: string; options: string[] }>>(
      db.from("quiz_questions").select("id,correct_answer,options").eq("quiz_id", input.quizId),
    ),
    unwrap<
      Array<{
        id: string;
        student_id: string;
        attempt_number: number;
        results: ScoredResult[];
        score: number;
        total: number;
      }>
    >(
      db
        .from("quiz_attempts")
        .select("id,student_id,attempt_number,results,score,total")
        .eq("quiz_id", input.quizId),
    ),
  ]);
  // Previously reviewed answers require a new explicit academic judgment.
  const reviewed = attempts.length
    ? await unwrap<Array<{ attempt_id: string; question_id: string }>>(
        db
          .from("quiz_question_reviews")
          .select("attempt_id,question_id")
          .in(
            "attempt_id",
            attempts.map((a) => a.id),
          ),
      )
    : [];
  const people = attempts.length
    ? await unwrap<Array<{ id: string; full_name: string }>>(
        db
          .from("profiles")
          .select("id,full_name")
          .in("id", [...new Set(attempts.map((a) => a.student_id))]),
      )
    : [];
  const proposals: Array<{
    attemptId: string;
    questionId: string;
    studentId: string;
    studentName: string;
    attemptNumber: number;
    answer: string;
    key: string;
    before: number;
    after: number;
  }> = [];
  for (const attempt of attempts)
    for (const r of attempt.results ?? []) {
      const question = questions.find((q) => q.id === r.id);
      if (
        !r.correct &&
        r.chosen &&
        question &&
        question.options.length === 0 &&
        !question.correct_answer.startsWith("Rubric:") &&
        !reviewed.some((v) => v.attempt_id === attempt.id && v.question_id === r.id) &&
        matchesIdentification(r.chosen, question.correct_answer)
      ) {
        proposals.push({
          attemptId: attempt.id,
          questionId: r.id,
          studentId: attempt.student_id,
          studentName:
            people.find((p) => p.id === attempt.student_id)?.full_name ?? "Unknown student",
          attemptNumber: attempt.attempt_number,
          answer: r.chosen,
          key: question.correct_answer,
          before: attempt.score,
          after: Math.min(attempt.total, attempt.score + 1),
        });
      }
    }
  return proposals;
}
