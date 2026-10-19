import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Calculator,
  Maximize2,
  Minimize2,
  FlaskConical,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  RotateCcw,
  ShieldCheck,
  Timer,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { setAssessmentMode } from "@/lib/assessment-mode";
import { EXAM_LOCKDOWN_COPY, LockdownOverlay } from "@/components/lockdown";
import { useLockdown, useLockdownDemand } from "@/hooks/useLockdown";
import { ArduinoLab } from "@/components/arduino-lab";
import {
  useAntiCheat,
  integrityLabel,
  isSevereIntegrityEvent,
  INTEGRITY_EVENT_TYPES,
} from "@/lib/anti-cheat";
import {
  getQuiz,
  submitQuizAnswers,
  type Quiz,
  type QuizQuestionPublic,
  type SubmitQuizResult,
} from "@/lib/lms";
import { Badge, Modal, useProfile } from "@/components/lms";
import { cn } from "@/lib/utils";
import { QUESTION_TYPE_LABELS } from "@/lib/question-types";
import { LoadingSkeleton } from "@/components/ui-elements";

type QuizSuccess = Extract<SubmitQuizResult, { ok: true }>;

/**
 * Stable idempotency key for a single worksheet attempt. Retrying a submit
 * (double-click, flaky network) reuses it so the server replays the stored
 * result instead of recording a duplicate attempt.
 */
function newSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function storedSubmissionId(id: string): string {
  try {
    const key = `miow_quiz_submission_${id}`;
    const saved = localStorage.getItem(key);
    if (saved && /^[a-f0-9-]{36}$/i.test(saved)) return saved;
    const fresh = newSubmissionId();
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return newSubmissionId();
  }
}

/** "Attempt 2 of 3", "Attempt 2", or "Unlimited attempts". */
function attemptLabel(used: number, allowed: number | null, next = false): string {
  const n = next ? used + 1 : used;
  if (allowed == null) return next ? `Attempt ${n} · unlimited` : `${used} used · unlimited`;
  return `Attempt ${n} of ${allowed}`;
}

function evaluateWorksheetExpression(expression: string): string {
  const normalized = expression.trim();
  if (!normalized || normalized.length > 160) return "Enter a calculation under 160 characters.";
  try {
    const tokens = normalized.match(/\d+(?:\.\d+)?|[A-Za-z]+|[()+\-*/%^]/g) ?? [];
    if (tokens.length > 80 || tokens.join("") !== normalized.replace(/\s+/g, ""))
      return "Invalid calculation.";
    let cursor = 0;
    const primary = (): number => {
      if (cursor > 80) throw new Error("expression too deep");
      const token = tokens[cursor++];
      if (token === "(") {
        const value = expressionValue();
        if (tokens[cursor++] !== ")") throw new Error("missing parenthesis");
        return value;
      }
      if (token === "+" || token === "-") {
        const value = primary();
        return token === "-" ? -value : value;
      }
      if (!token) throw new Error("invalid token");
      if (/^[A-Za-z]+$/.test(token)) {
        if (token === "pi") return Math.PI;
        if (token === "e") return Math.E;
        if (tokens[cursor++] !== "(") throw new Error("missing function parenthesis");
        const value = expressionValue();
        if (tokens[cursor++] !== ")") throw new Error("missing parenthesis");
        const functions: Record<string, (value: number) => number> = {
          abs: Math.abs,
          cos: Math.cos,
          ln: Math.log,
          log: Math.log10,
          sin: Math.sin,
          sqrt: Math.sqrt,
          tan: Math.tan,
        };
        const fn = functions[token];
        if (!fn) throw new Error("unknown function");
        return fn(value);
      }
      if (!/^\d/.test(token)) throw new Error("invalid token");
      return Number(token);
    };
    const power = (): number => {
      const value = primary();
      if (tokens[cursor] === "^") {
        cursor++;
        return value ** power();
      }
      return value;
    };
    const term = (): number => {
      let value = power();
      while (["*", "/", "%"].includes(tokens[cursor] ?? "")) {
        const operator = tokens[cursor++];
        const right = power();
        if (operator === "*") value *= right;
        else if (operator === "/") value /= right;
        else value %= right;
      }
      return value;
    };
    function expressionValue(): number {
      let value = term();
      while (["+", "-"].includes(tokens[cursor] ?? "")) {
        const operator = tokens[cursor++];
        const right = term();
        value = operator === "+" ? value + right : value - right;
      }
      return value;
    }
    const value = expressionValue();
    if (cursor !== tokens.length) return "Invalid calculation.";
    return typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "Invalid calculation.";
  } catch {
    return "Invalid calculation.";
  }
}

function isCalculationQuestion(question: QuizQuestionPublic | undefined): boolean {
  if (!question) return false;
  const text = question.question;
  return (
    /\b(calculate|compute|solve|determine|find|what is the value|how many|how much)\b/i.test(
      text,
    ) ||
    (/\b(resistance|voltage|current|power|ohm(?:s)?|watt(?:s)?|amp(?:s)?)\b/i.test(text) &&
      /\d/.test(text))
  );
}

function fourthChoiceFor(question: QuizQuestionPublic): string {
  const text = question.question.toLowerCase();
  if (text.includes("arduino")) return "microcontroller-based";
  if (text.includes("resistor") || text.includes("resistance")) return "wire-wound";
  return "embedded-system";
}

// Persist timer + answers per quiz so closing/reopening or accidental reload doesn't reset progress
const getStoredTimer = (id: string): number | null => {
  try {
    const v = localStorage.getItem(`miow_quiz_timer_${id}`);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
};
const setStoredTimer = (id: string, sec: number) => {
  try {
    localStorage.setItem(`miow_quiz_timer_${id}`, String(sec));
  } catch {
    /* ignore storage quota or access error */
  }
};
const clearStoredProgress = (id: string) => {
  try {
    localStorage.removeItem(`miow_quiz_timer_${id}`);
    localStorage.removeItem(`miow_quiz_answers_${id}`);
    localStorage.removeItem(`miow_quiz_questions_${id}`);
    localStorage.removeItem(`miow_quiz_submission_${id}`);
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(`miow_lab_${id}:`)) sessionStorage.removeItem(key);
  } catch {
    /* ignore storage access error */
  }
};
const getStoredAnswers = (id: string): Record<string, string> => {
  try {
    const v = localStorage.getItem(`miow_quiz_answers_${id}`);
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
};
const setStoredAnswers = (id: string, a: Record<string, string>) => {
  try {
    localStorage.setItem(`miow_quiz_answers_${id}`, JSON.stringify(a));
  } catch {
    /* ignore storage quota or access error */
  }
};
// Persist the drawn question set per quiz so a mid-exam reload resumes the
// SAME questions (the server draws a fresh random subset per getQuiz call,
// which would orphan answers to the previously drawn items).
const getStoredQuestions = (id: string): QuizQuestionPublic[] | null => {
  try {
    const v = localStorage.getItem(`miow_quiz_questions_${id}`);
    const parsed: unknown = v ? JSON.parse(v) : null;
    return Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((q) => typeof q?.id === "string")
      ? (parsed as QuizQuestionPublic[])
      : null;
  } catch {
    return null;
  }
};
const setStoredQuestions = (id: string, qs: QuizQuestionPublic[]) => {
  try {
    localStorage.setItem(`miow_quiz_questions_${id}`, JSON.stringify(qs));
  } catch {
    /* ignore storage quota or access error */
  }
};

export function WorksheetSession({ quiz, onClose }: { quiz: Quiz; onClose: () => void }) {
  const profile = useProfile(["student"]);
  const progressKey = useCallback(
    (id: string) => `${profile?.id ?? "signed-out"}:${id}`,
    [profile?.id],
  );
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(quiz.id);
  const activeQuiz = quiz;
  useEffect(() => {
    if (!activeId) onClose();
  }, [activeId, onClose]);
  const [questions, setQuestions] = useState<QuizQuestionPublic[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [idx, setIdx] = useState(0);
  // Collapsible Arduino Lab panel for problem-solving (lab_task) items.
  const [labOpen, setLabOpen] = useState(true);
  const [labFullscreen, setLabFullscreen] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    action: string;
    cancel: string;
    confirm: () => void;
  } | null>(null);
  // Auto-generated wiring description from the Arduino Lab (manual wires)
  const [connSummary, setConnSummary] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // Which worksheet the timer/answers below belong to, and whether the current
  // attempt has finished loading. Both are guards against a newly selected
  // worksheet inheriting the previous one's countdown/answers while its async
  // fetch is still resolving — timer and answers are persisted per quiz id, so
  // a stale write under the new id would leak the old attempt's state forward.
  const [readyQuizId, setReadyQuizId] = useState<string | null>(null);
  const [loadingAttempt, setLoadingAttempt] = useState(true);
  const [result, setResult] = useState<QuizSuccess | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [calculatorExpression, setCalculatorExpression] = useState("");
  const [calculatorResult, setCalculatorResult] = useState<string | null>(null);
  const currentQuestionId = questions[idx]?.id;
  useEffect(() => {
    setCalculatorOpen(false);
    setCalculatorExpression("");
    setCalculatorResult(null);
  }, [currentQuestionId]);
  const finishRef = useRef<(() => Promise<void>) | null>(null);
  const warnedAttemptRef = useRef<string | null>(null);
  const attemptLoadRef = useRef(0);
  const savedTimerRef = useRef<Map<string, number>>(new Map());
  const savedAnswersRef = useRef<Map<string, Record<string, string>>>(new Map());
  // Persist the sampled question set for the in-progress attempt so reopening a
  // worksheet keeps the SAME questions (answers stay mapped). Cleared on submit,
  // so the next attempt (retake) fetches a fresh, non-overlapping bank subset.
  const savedAttemptRef = useRef<
    Map<
      string,
      {
        questions: QuizQuestionPublic[];
        duration: number;
        // Hard availability deadline (epoch ms) — the server rejects any submit
        // after closes_at, so the countdown must be clamped to this window.
        closesAt: number | null;
        submissionId: string;
      }
    >
  >(new Map());

  // Assessment integrity: hide the ClassMate Assistant while a worksheet is
  // actively being taken (restored on the review screen and on unmount).
  const taking = !!activeId && !result;
  useEffect(() => {
    setAssessmentMode(taking);
    return () => setAssessmentMode(false);
  }, [taking]);

  // Anti-cheat: detect tab switches / devtools / paste during active assessment
  const integrityActive =
    taking && readyQuizId === activeId && !loadingAttempt && questions.length > 0;
  const handleFirstIntegrityEvent = useCallback(
    (event: { type: Parameters<typeof integrityLabel>[0] }) => {
      toast.warning("Integrity rule triggered", {
        description: `${integrityLabel(event.type)} detected. Your worksheet is being submitted automatically.`,
        duration: 6000,
      });
      void finishRef.current?.();
    },
    [],
  );
  const { tabSwitches, switchCount, counts, showFlash, flashType } = useAntiCheat(
    integrityActive,
    handleFirstIntegrityEvent,
  );
  // Hard lock while taking: fullscreen + input blocking (installed PWA kiosk).
  // The exam demand joins the app-wide kiosk lockdown through the single
  // shared activation (LockdownProvider in the student layout) so the two
  // flows never double-fire.
  useLockdownDemand("exam", taking);
  const examLock = useLockdown();

  // Resume or start attempt: restore saved timer/answers if the student
  // closed and reopened the same worksheet within this session.
  const beginAttempt = useCallback(
    async (id: string) => {
      const loadId = ++attemptLoadRef.current;
      // Reuse the in-progress attempt's sampled questions when present so a
      // reopen doesn't swap the question set (and lose already-answered items).
      let attempt = savedAttemptRef.current.get(id);
      if (!attempt) {
        const { quiz, questions } = await getQuiz(id);
        if (loadId !== attemptLoadRef.current) return;
        // A reload mid-exam must resume the SAME drawn subset — prefer the
        // persisted set over the server's fresh draw. Cleared on submit/retake,
        // so a NEW attempt still fetches a fresh set.
        let persisted = getStoredQuestions(progressKey(id));
        // An older cached paper must not hide formats added to the IT10 bank.
        // This applies only to banks explicitly carrying all four formats.
        const formats = Object.keys(QUESTION_TYPE_LABELS);
        if (
          persisted &&
          formats.every((type) => questions.some((q) => q.question_type === type)) &&
          !formats.every((type) => persisted!.some((q) => q.question_type === type))
        ) {
          persisted = null;
          clearStoredProgress(progressKey(id));
          savedAnswersRef.current.delete(id);
          savedTimerRef.current.delete(id);
          toast.info(
            "This worksheet was updated. Your new paper includes all four question types.",
          );
        }
        attempt = {
          questions: persisted ?? questions,
          duration: quiz.duration_minutes * 60,
          closesAt: quiz.closes_at ? new Date(quiz.closes_at).getTime() : null,
          submissionId: storedSubmissionId(progressKey(id)),
        };
        if (!persisted) setStoredQuestions(progressKey(id), attempt.questions);
        savedAttemptRef.current.set(id, attempt);
      }
      if (loadId !== attemptLoadRef.current) return;
      setQuestions(attempt.questions);
      setResult(null);
      // Restore saved answers if they exist for this quiz
      const localAnswers = getStoredAnswers(progressKey(id));
      const inMemAnswers = savedAnswersRef.current.get(id);
      const restoredAnswers =
        Object.keys(localAnswers).length > 0 ? localAnswers : (inMemAnswers ?? {});
      setAnswers(restoredAnswers);
      setIdx(0);
      // The server hard-blocks any submit after closes_at, so the countdown must
      // never run past the window: clamp the starting seconds to the time
      // remaining until closes_at (effective = min(duration, window remaining)).
      const windowSec =
        attempt.closesAt != null
          ? Math.max(0, Math.floor((attempt.closesAt - Date.now()) / 1000))
          : Number.POSITIVE_INFINITY;
      const startSec = Math.min(attempt.duration, windowSec);
      if (!Number.isFinite(startSec) || startSec <= 0)
        throw new Error("This worksheet is no longer available.");
      // Restore saved timer or start fresh. Restored time is clamped to the
      // window too, so a resumed attempt can't exceed closes_at either.
      const localTimer = getStoredTimer(progressKey(id));
      const saved = savedTimerRef.current.get(id);
      const activeSec = localTimer ?? saved;
      if (activeSec != null && activeSec > 0) {
        setSecondsLeft(Math.min(activeSec, windowSec));
      } else {
        setSecondsLeft(startSec);
      }
      // Arm the guard only once this worksheet's own questions/answers/timer are
      // all applied, so the persistence effects never write them under another id.
      setReadyQuizId(id);
    },
    [profile?.email, progressKey],
  );

  useEffect(() => {
    let cancelled = false;
    if (activeId && profile?.id) {
      submittedRef.current = false;
      // Disarm the guard for the async window: the render right after the id
      // change still holds the previous worksheet's state, and beginAttempt
      // re-arms it when the fresh attempt is applied.
      setReadyQuizId(null);
      setSecondsLeft(null);
      setLoadingAttempt(true);
      void beginAttempt(activeId)
        .catch((error: unknown) => {
          if (cancelled) return;
          toast.error(
            error instanceof Error && error.message === "This worksheet is no longer available."
              ? error.message
              : "Could not open this worksheet. Please try again.",
          );
          setActiveId(null);
        })
        .finally(() => {
          if (!cancelled) setLoadingAttempt(false);
        });
    }
    return () => {
      cancelled = true;
      attemptLoadRef.current += 1;
    };
  }, [activeId, beginAttempt, profile?.id]);

  useEffect(() => {
    if (
      activeId &&
      readyQuizId === activeId &&
      !loadingAttempt &&
      !result &&
      warnedAttemptRef.current !== activeId
    ) {
      warnedAttemptRef.current = activeId;
      toast.warning("Before you begin", {
        description:
          "Keep this worksheet tab focused. Leaving the tab, pasting, opening developer tools, or exiting fullscreen triggers one warning and submits your attempt automatically.",
        duration: 9000,
      });
    }
    if (result) warnedAttemptRef.current = null;
  }, [activeId, loadingAttempt, readyQuizId, result]);

  useEffect(() => {
    if (!activeId || readyQuizId !== activeId || result || secondsLeft == null || secondsLeft <= 0)
      return;
    // Persist remaining time so closing/reopening or reload preserves it
    savedTimerRef.current.set(activeId, secondsLeft);
    setStoredTimer(progressKey(activeId), secondsLeft);
    const t = setTimeout(
      () => setSecondsLeft((s) => (s == null ? null : Math.max(0, s - 1))),
      1000,
    );
    return () => clearTimeout(t);
  }, [activeId, readyQuizId, secondsLeft, result, progressKey]);

  // Persist answers per quiz so closing/reopening preserves progress
  useEffect(() => {
    if (activeId && readyQuizId === activeId && !result && Object.keys(answers).length > 0) {
      savedAnswersRef.current.set(activeId, answers);
      setStoredAnswers(progressKey(activeId), answers);
    }
  }, [activeId, readyQuizId, answers, result, progressKey]);

  // Clear saved progress on successful submission
  useEffect(() => {
    if (result?.ok && activeId) {
      savedTimerRef.current.delete(activeId);
      savedAnswersRef.current.delete(activeId);
      savedAttemptRef.current.delete(activeId);
      clearStoredProgress(progressKey(activeId));
    }
  }, [result, activeId, progressKey]);

  const submittedRef = useRef(false);

  useEffect(() => {
    if (
      activeId &&
      readyQuizId === activeId &&
      !loadingAttempt &&
      secondsLeft === 0 &&
      finishRef.current
    )
      finishRef.current();
  }, [activeId, readyQuizId, secondsLeft, loadingAttempt]);

  if (!profile) return null;

  const finish = async () => {
    if (!activeId || result || !questions.length || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      // Answers are scored server-side; the server enforces the retake policy
      // before recording the attempt. Pass question_ids for question bank scoring.
      const res = await submitQuizAnswers(
        activeId,
        answers,
        questions.map((q) => q.id),
        tabSwitches,
        savedAttemptRef.current.get(activeId)?.submissionId,
      );
      await queryClient.invalidateQueries({ queryKey: ["quiz-summaries"] });
      if (!res.ok) {
        toast.error(
          res.reason === "retakes_disabled"
            ? "Retakes are not permitted for this worksheet."
            : "Maximum attempts exceeded for this worksheet.",
        );
        setActiveId(null);
        return;
      }
      setResult(res);
    } catch {
      // Network drop / transient error: allow the student to retry instead of
      // leaving them stuck on a permanently-disabled submit button.
      submittedRef.current = false;
      toast.error("Could not score the worksheet — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  finishRef.current = finish;

  const mm = String(Math.floor((secondsLeft ?? 0) / 60)).padStart(2, "0");
  const ss = String((secondsLeft ?? 0) % 60).padStart(2, "0");
  const current = questions[idx];
  const currentOptions =
    current?.question_type === "multiple_choice" && current.options.length === 3
      ? [...current.options, fourthChoiceFor(current)]
      : (current?.options ?? []);
  const calculationQuestion = isCalculationQuestion(current);
  const answeredCount = questions.filter((q) => answers[q.id]?.trim()).length;

  return (
    <>
      <Modal
        open={!!activeId}
        onClose={() => {
          if (confirmation) return;
          // Worksheets stay locked in the fullscreen assessment view. The
          // student can leave through the explicit Done/submit actions only.
          if (result) setActiveId(null);
        }}
        fullscreen
        hideClose
        title={activeQuiz?.title ?? "Worksheet"}
        wide
      >
        {result ? (
          // Teacher-gated release: server gates score/answer_key; client mirrors via result.score_released
          result.score == null ||
          (result as unknown as { score_released?: boolean })?.score_released === false ? (
            <div className="flex flex-col items-center py-8 text-center">
              <ShieldCheck className="h-12 w-12 text-amber-500" />
              <p className="mt-3 text-base font-semibold">Awaiting teacher release</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your worksheet has been submitted. Your teacher will release your score soon.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Attempt {result.attempts_used} of {result.attempts_allowed ?? "∞"} recorded — score
                hidden until release.
              </p>
              <div className="mt-4 flex flex-col gap-2 w-full">
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center text-xs text-amber-800 dark:text-amber-200">
                  Awaiting teacher release — submitted. You&apos;ll see your score and review once
                  your teacher releases it.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex flex-col items-center py-4 text-center">
                <CheckCircle2 className="h-14 w-14 text-emerald-500" />
                <p className="mt-3 font-display text-3xl font-bold">
                  {result.score} / {result.total ?? 0}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {Math.round((result.score / Math.max(1, result.total ?? 0)) * 100)}% —{" "}
                  {result.score / Math.max(1, result.total ?? 0) >= 0.75
                    ? "Great job!"
                    : "Review the material and try again in class."}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <Badge tone="indigo">
                    {attemptLabel(result.attempts_used, result.attempts_allowed)}
                  </Badge>
                  {result.effective_score !== result.score && (
                    <Badge tone="green">
                      Gradebook score: {result.effective_score}/{result.total ?? 0} (
                      {result.retake_score_policy === "highest_score"
                        ? "highest kept"
                        : result.retake_score_policy === "average_score"
                          ? "average of attempts"
                          : "latest attempt"}
                      )
                    </Badge>
                  )}
                </div>
              </div>

              {/* Per-question review */}
              <div className="mt-2 space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Review
                </p>
                {result.results.length === 0 ? (
                  // Server withholds per-question rows until the teacher
                  // releases them — render the empty state gracefully.
                  <p className="rounded-xl border border-border/60 bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">
                    Results will appear when your teacher releases scores.
                  </p>
                ) : (
                  result.results.map((r, i) => (
                    <div key={r.id} className="rounded-xl border border-border/70 p-4">
                      <div className="flex items-start gap-2">
                        {r.correct ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        ) : (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                        )}
                        <p className="text-sm font-semibold">
                          {i + 1}. {r.question}
                        </p>
                      </div>
                      {r.image_url && (
                        <img
                          src={r.image_url}
                          alt="Question illustration"
                          className="mt-2 max-h-40 rounded-lg border border-border object-contain"
                        />
                      )}
                      {r.options.length === 0 ? (
                        <div className="mt-2 space-y-1.5 text-xs">
                          <p className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground">
                            Your answer: {r.chosen?.trim() ? r.chosen : "Not answered"}
                          </p>
                          <p className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                            {r.correct_answer?.startsWith("Rubric:")
                              ? // Strip the auto-grader's "| Keywords: ..." block from the review display.
                                `Rubric: ${r.correct_answer.slice("Rubric:".length).split("| Keywords:")[0]!.trim()}`
                              : `Answer: ${r.correct_answer?.split("||")[0]}`}
                          </p>
                          {r.correct_answer?.startsWith("Rubric:") && !r.correct && (
                            <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-rose-700 dark:text-rose-300">
                              Auto-graded: answers need at least 5 real words and must cover the
                              rubric's key concepts — gibberish or one-word replies fail
                              automatically.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                          {r.options.map((opt) => {
                            const isCorrect = opt === r.correct_answer;
                            const isChosen = opt === r.chosen;
                            return (
                              <p
                                key={opt}
                                className={cn(
                                  "rounded-lg border px-3 py-1.5 text-xs",
                                  isCorrect
                                    ? "border-emerald-500/50 bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300"
                                    : isChosen
                                      ? "border-rose-500/50 bg-rose-500/10 font-semibold text-rose-700 dark:text-rose-300"
                                      : "border-border text-muted-foreground",
                                )}
                              >
                                {opt}
                                {isCorrect && " ✓"}
                                {isChosen && !isCorrect && " — your answer"}
                              </p>
                            );
                          })}
                        </div>
                      )}
                      {!r.chosen && r.options.length > 0 && (
                        <p className="mt-1.5 text-xs text-muted-foreground">Not answered</p>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Retake actions */}
              <div className="mt-5 flex flex-col gap-2">
                {result.can_retake ? (
                  <button
                    type="button"
                    onClick={() => {
                      examLock.lock();
                      if (activeId) void beginAttempt(activeId);
                    }}
                    className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Retake Worksheet —{" "}
                    {attemptLabel(result.attempts_used, result.attempts_allowed, true)}
                  </button>
                ) : (
                  <p className="rounded-xl border border-border/60 bg-muted/60 px-4 py-3 text-center text-xs text-muted-foreground">
                    Maximum attempts reached. Contact your teacher to request a retake.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className={cn(
                    "h-11 w-full rounded-xl text-sm font-semibold",
                    result.can_retake
                      ? "border border-border hover:bg-muted"
                      : "bg-primary text-primary-foreground",
                  )}
                >
                  Done
                </button>
              </div>
            </div>
          )
        ) : loadingAttempt ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* Hard lock: fullscreen was exited mid-exam — block the paper
                until the student returns to fullscreen (tap = new gesture). */}
            {examLock.lockLost && (
              <LockdownOverlay copy={EXAM_LOCKDOWN_COPY} onReturn={() => examLock.lock()} />
            )}
            <div className="mb-2 flex items-center justify-between rounded-xl bg-muted px-4 py-2.5">
              <Badge tone="indigo">{questions.length} questions</Badge>
              <p
                className={cn(
                  "flex items-center gap-1.5 font-display text-lg font-bold tabular-nums",
                  secondsLeft != null && secondsLeft < 60 && "text-rose-600",
                )}
              >
                <Timer className="h-4 w-4" /> {mm}:{ss}
              </p>
            </div>
            <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
              <p className="font-semibold">One integrity warning</p>
              <p className="mt-0.5">
                Keep this worksheet focused. Leaving the tab, pasting, opening developer tools, or
                exiting fullscreen submits this attempt automatically.
              </p>
            </div>
            <p className="mb-4 flex items-center gap-1.5 rounded-xl border border-border/60 bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              Assessment integrity: the ClassMate Assistant is disabled until you submit.
            </p>

            {/* Anti-cheat: integrity warning */}
            {switchCount > 0 && (
              <div
                className={cn(
                  "mb-4 rounded-xl border px-3 py-2 text-xs transition-colors",
                  showFlash
                    ? flashType && isSevereIntegrityEvent(flashType)
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400",
                )}
              >
                <p className="flex items-center gap-1.5 font-semibold">
                  <EyeOff className="h-3.5 w-3.5 shrink-0" />
                  {showFlash && flashType
                    ? `${integrityLabel(flashType)} recorded`
                    : "Integrity events are being logged"}
                  <span className="ml-auto font-bold tabular-nums">{switchCount} total</span>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {INTEGRITY_EVENT_TYPES.filter((t) => counts[t] > 0).map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-current/25 px-2 py-0.5 text-[10px] font-medium"
                    >
                      {integrityLabel(t)} · {counts[t]}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] opacity-80">
                  Keep this tab focused while answering — repeated events are shared with your
                  teacher.
                </p>
              </div>
            )}

            {/* Stepper dots */}
            <div className="mb-5 flex flex-wrap items-center gap-1.5">
              {questions.map((q, i) => (
                <button
                  type="button"
                  key={q.id}
                  onClick={() => setIdx(i)}
                  aria-label={`Go to question ${i + 1}`}
                  data-testid={`question-nav-${i + 1}`}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold transition-colors",
                    i === idx
                      ? "bg-primary text-primary-foreground ring-2 ring-primary/40"
                      : answers[q.id]
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {i + 1}
                </button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground">
                {answeredCount}/{questions.length} answered
              </span>
            </div>

            {current && (
              <div>
                {current.question_type && (
                  <div className="mb-2">
                    <Badge tone="indigo">{QUESTION_TYPE_LABELS[current.question_type]}</Badge>
                  </div>
                )}
                <p data-testid="worksheet-question" className="mb-3 text-sm font-semibold">
                  {idx + 1}. {current.question}
                </p>
                {current.image_url && (
                  <img
                    src={current.image_url}
                    alt="Question illustration"
                    className="mx-auto mb-3 max-h-56 rounded-lg border border-border bg-background object-contain"
                  />
                )}
                {current.question_type === "matching" ? (
                  <div className="space-y-2">
                    <label htmlFor={`match-${current.id}`} className="block text-sm font-medium">
                      Column B — choose the matching description
                    </label>
                    <select
                      id={`match-${current.id}`}
                      value={answers[current.id] ?? ""}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [current.id]: e.target.value }))
                      }
                      className="min-h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <option value="">Select a match…</option>
                      {current.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : current.options.length === 0 ? (
                  // Fill-in-the-blank and essay items have no options — free text.
                  <textarea
                    value={answers[current.id] ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [current.id]: e.target.value }))}
                    data-testid="answer-input"
                    aria-label={`Answer to question ${idx + 1}`}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.stopPropagation();
                    }}
                    placeholder={
                      current.lab_task
                        ? "Type or paste your final code / circuit description here…"
                        : "Type your answer here…"
                    }
                    rows={current.lab_task ? 8 : 3}
                    className={cn(
                      "w-full rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring",
                      current.lab_task && "font-mono",
                    )}
                  />
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {currentOptions.map((opt) => (
                      <button
                        type="button"
                        key={opt}
                        onClick={() => setAnswers((a) => ({ ...a, [current.id]: opt }))}
                        className={cn(
                          "rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
                          answers[current.id] === opt
                            ? "border-primary bg-primary/10 font-semibold"
                            : "border-border hover:border-primary/40 hover:bg-muted",
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
                {current.lab_task && (
                  <>
                    {/* Auto-generated connections summary from the lab's manual wiring */}
                    <div
                      data-testid="connections-summary"
                      className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">
                          🔌 Connections summary (auto-generated from your wires)
                        </span>
                        <button
                          type="button"
                          data-testid="insert-connections"
                          disabled={!connSummary}
                          onClick={() => {
                            if (!connSummary) return;
                            setAnswers((a) => {
                              const prevText = a[current.id] ?? "";
                              return {
                                ...a,
                                [current.id]: prevText
                                  ? `${prevText}\n${connSummary}`
                                  : connSummary,
                              };
                            });
                          }}
                          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300"
                        >
                          Insert into answer
                        </button>
                      </div>
                      <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
                        {connSummary ||
                          "No jumper wires yet — wire some terminals in the lab below and this description fills in automatically."}
                      </p>
                    </div>

                    <div
                      className={cn(
                        "mt-4 overflow-hidden rounded-xl border border-primary/30",
                        labFullscreen &&
                          "absolute inset-0 z-10 m-0 flex flex-col rounded-none border-0 bg-background",
                      )}
                      data-fullscreen-content={labFullscreen || undefined}
                    >
                      <div className="flex items-center bg-primary/5">
                        <button
                          type="button"
                          aria-expanded={labOpen}
                          data-testid="lab-panel-toggle"
                          onClick={() => setLabOpen((o) => !o)}
                          className="flex w-full items-center justify-between gap-2 bg-primary/5 px-4 py-3 text-left text-sm font-semibold hover:bg-primary/10"
                        >
                          <span className="flex items-center gap-2">
                            <FlaskConical className="h-4 w-4 shrink-0" />
                            Arduino Lab
                          </span>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 shrink-0 transition-transform",
                              labOpen && "rotate-180",
                            )}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setLabOpen(true);
                            setLabFullscreen((v) => !v);
                          }}
                          className="m-2 inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold hover:bg-muted"
                          aria-label={labFullscreen ? "Return to worksheet" : "Open lab fullscreen"}
                        >
                          {labFullscreen ? (
                            <Minimize2 className="h-4 w-4" />
                          ) : (
                            <Maximize2 className="h-4 w-4" />
                          )}
                          {labFullscreen ? "Return to worksheet" : "Fullscreen"}
                        </button>
                      </div>
                      {labFullscreen && (
                        <div className="border-t border-primary/20 bg-primary/5 px-4 py-3 text-sm font-semibold">
                          Question {idx + 1}: {current.question}
                        </div>
                      )}
                      {labOpen && (
                        <div
                          className={cn(
                            "overflow-auto border-t border-border p-3",
                            labFullscreen ? "min-h-0 flex-1" : "max-h-[70vh]",
                          )}
                        >
                          <ArduinoLab
                            key={`${activeId}:${current.id}`}
                            persistenceKey={`${progressKey(activeId ?? quiz.id)}:${current.id}`}
                            initialTask={null}
                            onConnectionsChange={setConnSummary}
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
                {calculationQuestion && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setCalculatorOpen((open) => !open)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-muted"
                    >
                      <Calculator className="h-4 w-4" />{" "}
                      {calculatorOpen ? "Hide calculator" : "Open calculator"}
                    </button>
                    {calculatorOpen && (
                      <div className="mt-2 max-w-md rounded-xl border border-border bg-muted/40 p-3">
                        <label
                          className="block text-xs font-semibold"
                          htmlFor="worksheet-calculator"
                        >
                          Scientific calculator{" "}
                          <span className="font-normal text-muted-foreground">(radians)</span>
                        </label>
                        <div className="mt-2 grid grid-cols-6 gap-1">
                          {[
                            "sin(",
                            "cos(",
                            "tan(",
                            "sqrt(",
                            "log(",
                            "ln(",
                            "π",
                            "e",
                            "^",
                            "(",
                            ")",
                            "AC",
                          ].map((token) => (
                            <button
                              key={token}
                              type="button"
                              onClick={() => {
                                if (token === "AC") {
                                  setCalculatorExpression("");
                                  setCalculatorResult(null);
                                  return;
                                }
                                const value = token === "π" ? "pi" : token;
                                setCalculatorExpression((expression) => `${expression}${value}`);
                                setCalculatorResult(null);
                              }}
                              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-semibold hover:bg-muted"
                            >
                              {token}
                            </button>
                          ))}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <input
                            id="worksheet-calculator"
                            value={calculatorExpression}
                            onChange={(e) => {
                              setCalculatorExpression(e.target.value);
                              setCalculatorResult(null);
                            }}
                            inputMode="decimal"
                            placeholder="Example: sqrt(220^2 + 100^2)"
                            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setCalculatorResult(evaluateWorksheetExpression(calculatorExpression))
                            }
                            className="rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
                          >
                            Calculate
                          </button>
                        </div>
                        {calculatorResult && (
                          <p className="mt-2 text-sm font-semibold">= {calculatorResult}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* File upload for quiz submissions is not yet implemented — see submission_files table */}

            <div className="mt-6 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
                disabled={idx === 0}
                className="flex h-11 items-center gap-1 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>
              {idx < questions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}
                  className="flex h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const unans = questions.length - answeredCount;
                    const warn =
                      unans > 0
                        ? `You have ${unans} unanswered question${unans === 1 ? "" : "s"}. Are you sure you want to submit?`
                        : "Are you sure you want to submit your answers? This attempt will be finalized.";
                    setConfirmation({
                      title: "Submit worksheet?",
                      description: warn,
                      action: "Submit answers",
                      cancel: "Review answers",
                      confirm: () => {
                        void finish();
                      },
                    });
                  }}
                  disabled={submitting}
                  className="h-11 flex-1 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting
                    ? "Submitting…"
                    : `Submit answers (${answeredCount}/${questions.length})`}
                </button>
              )}
            </div>
          </>
        )}
      </Modal>
      <AlertDialog.Root
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-slate-950/50" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-xl">
            <AlertDialog.Title className="text-lg font-bold">
              {confirmation?.title}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {confirmation?.description}
            </AlertDialog.Description>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <AlertDialog.Cancel className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted">
                {confirmation?.cancel}
              </AlertDialog.Cancel>
              <AlertDialog.Action
                onClick={() => confirmation?.confirm()}
                className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                {confirmation?.action}
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
