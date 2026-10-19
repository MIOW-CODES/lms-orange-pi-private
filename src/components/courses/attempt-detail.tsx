import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, EyeOff, Save, X } from "lucide-react";
import {
  listStudentAttemptDetail,
  overrideQuizAttempt,
  reviewAttemptQuestion,
  previewIdentificationRegrade,
} from "@/lib/lms";
import { Badge } from "@/components/lms";
import { switchSeverity } from "@/lib/anti-cheat";
import { cn, sanitizeDecimal } from "@/lib/utils";

/**
 * Per-question inspection of one student's worksheet attempts, plus a teacher
 * override form. The Automatic scoring can misgrade essays/short answers, so the teacher's
 * score always supersedes the computed effective score.
 */
export function AttemptDetail({
  quizId,
  studentId,
  studentName,
  onChanged,
}: {
  quizId: string;
  studentId: string;
  studentName: string;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["quiz-attempt-detail", quizId, studentId],
    queryFn: () => listStudentAttemptDetail(quizId, studentId),
  });

  const [score, setScore] = useState<string>("");
  const [total, setTotal] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<{
    attemptId: string;
    questionId: string;
    expected: boolean;
  } | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [proposals, setProposals] = useState<Awaited<
    ReturnType<typeof previewIdentificationRegrade>
  > | null>(null);
  const correctQuestion = async () => {
    if (!review || !reviewReason.trim()) return;
    setSaving(true);
    try {
      await reviewAttemptQuestion({
        quizId,
        ...review,
        correct: !review.expected,
        reason: reviewReason.trim(),
      });
      setReview(null);
      setReviewReason("");
      refresh();
      toast.success("Question reviewed. Course grades remain unchanged until republished.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review this answer.");
    } finally {
      setSaving(false);
    }
  };

  // Seed the override form once per loaded student (effect, not render, so it
  // is StrictMode-safe and never clobbers in-progress edits on re-render).
  useEffect(() => {
    if (!data) return;
    setScore(data.override?.score?.toString() ?? "");
    setTotal(data.override?.total?.toString() ?? "");
    setNotes(data.override?.notes ?? "");
  }, [data, studentId]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quiz-attempt-detail", quizId, studentId] });
    qc.invalidateQueries({ queryKey: ["quiz-attempts", quizId] });
    qc.invalidateQueries({ queryKey: ["quiz-scores"] });
    qc.invalidateQueries({ queryKey: ["class-record"] });
    onChanged?.();
  };

  const saveOverride = async () => {
    if (saving) return;
    // Validate before entering the saving state so an invalid input never
    // touches the button/loading state at all.
    const parsedScore = score.trim() === "" ? null : Number(score);
    const parsedTotal = total.trim() === "" ? null : Number(total);
    if (parsedScore != null && (!Number.isFinite(parsedScore) || parsedScore < 0)) {
      toast.error("Score must be a non-negative number.");
      return;
    }
    if (parsedTotal != null && (!Number.isFinite(parsedTotal) || parsedTotal <= 0)) {
      toast.error("Total must be a positive number.");
      return;
    }
    if (!notes.trim()) {
      toast.error("Enter a reason for changing this score.");
      return;
    }
    setSaving(true);
    try {
      await overrideQuizAttempt(quizId, studentId, parsedScore, parsedTotal, notes.trim() || null);
      toast.success("Override saved — this supersedes the automatic score.");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the override.");
    } finally {
      setSaving(false);
    }
  };

  if (error)
    return (
      <div className="mt-3 border-t border-border/60 py-6 text-center">
        <p className="text-sm font-semibold text-rose-600">Could not load attempt details.</p>
        <button
          type="button"
          disabled={isFetching}
          onClick={() => void refetch()}
          className="mt-3 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50"
        >
          {isFetching ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  if (isLoading)
    return <p className="py-6 text-center text-sm text-muted-foreground">Loading attempt…</p>;
  if (!data) return null;

  return (
    <div className="mt-3 space-y-4 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">{studentName}</p>
        {data.override && (
          <Badge tone="amber">
            Teacher override: {data.override.score ?? "—"}/{data.override.total ?? "—"}
          </Badge>
        )}
      </div>

      <button
        type="button"
        className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
        disabled={saving}
        onClick={async () => {
          try {
            setProposals(await previewIdentificationRegrade(quizId));
          } catch {
            toast.error("Could not preview identification regrading.");
          }
        }}
      >
        Preview identification corrections
      </button>
      {proposals && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm">
            {proposals.length} verified identification matches across this worksheet. Original
            responses and teacher overrides are preserved.
          </p>
          {proposals.map((p) => (
            <div
              key={`${p.attemptId}:${p.questionId}`}
              className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-xs"
            >
              <span>
                {p.studentName} · attempt {p.attemptNumber} · “{p.answer}” → {p.key}
              </span>
              <button
                type="button"
                className="min-h-10 rounded border border-border px-2"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await reviewAttemptQuestion({
                      quizId,
                      attemptId: p.attemptId,
                      questionId: p.questionId,
                      correct: true,
                      expected: false,
                      reason: `Verified identification alias: ${p.key}`.slice(0, 1000),
                    });
                    setProposals((list) => list?.filter((x) => x !== p) ?? null);
                    refresh();
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Could not apply correction.",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Approve correction
              </button>
            </div>
          ))}
        </div>
      )}
      {review && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <label className="block text-sm">
            Reason for changing this answer to {review.expected ? "incorrect" : "correct"}
            <textarea
              aria-label="Question review reason"
              className="mt-1 min-h-20 w-full rounded border border-input bg-background p-2"
              value={reviewReason}
              onChange={(e) => setReviewReason(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="min-h-10 rounded bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={saving || !reviewReason.trim()}
            onClick={() => void correctQuestion()}
          >
            Apply question correction
          </button>
          <button
            type="button"
            className="ml-2 min-h-10 px-3 text-sm"
            onClick={() => setReview(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {data.attempts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attempts recorded.</p>
      ) : (
        data.attempts.map((a) => {
          const switches = a.tab_switches.length;
          const severity = switchSeverity(switches);
          return (
            <div key={a.attempt_number} className="rounded-xl border border-border/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  Attempt #{a.attempt_number} — {a.score}/{a.total}
                </p>
                {a.integrity_penalty > 0 && (
                  <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
                    Raw {a.raw_score}/{a.total} · −{a.integrity_penalty} integrity point
                    {a.integrity_penalty === 1 ? "" : "s"}
                  </span>
                )}
                {switches > 0 && a.integrity_penalty === 0 && (
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold",
                      severity.bg,
                      severity.text,
                    )}
                  >
                    <EyeOff className="h-3 w-3" /> {switches} tab switch(es)
                  </span>
                )}
              </div>
              <ul className="mt-2 space-y-2">
                {a.results.map((r) => (
                  <li key={r.id} className="rounded-lg bg-muted/40 p-2.5 text-sm">
                    <div className="flex items-start gap-2">
                      {r.correct ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      ) : (
                        <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{r.question}</p>
                        <button
                          type="button"
                          className="my-1 min-h-9 rounded border border-border px-2 text-xs font-semibold hover:bg-muted"
                          disabled={saving}
                          onClick={() => {
                            setReview({ attemptId: a.id, questionId: r.id, expected: r.correct });
                            setReviewReason("");
                          }}
                        >
                          Review this answer
                        </button>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Answered:{" "}
                          <span className={r.correct ? "text-emerald-600" : "text-rose-600"}>
                            {r.chosen ?? "— (blank)"}
                          </span>
                        </p>
                        {!r.correct && (
                          <p className="text-xs text-muted-foreground">
                            Expected: <span className="text-foreground">{r.correct_answer}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}

      {/* Teacher override form */}
      <div className="rounded-xl bg-muted/40 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Teacher override (supersedes automatic score)
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={score}
            onChange={(e) => setScore(sanitizeDecimal(e.target.value))}
            inputMode="decimal"
            placeholder="Score"
            aria-label="Override score"
            className="h-10 w-24 rounded-lg border border-input bg-background px-3 text-center text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-muted-foreground">/</span>
          <input
            value={total}
            onChange={(e) => setTotal(sanitizeDecimal(e.target.value))}
            inputMode="decimal"
            placeholder="Total"
            aria-label="Override total"
            className="h-10 w-24 rounded-lg border border-input bg-background px-3 text-center text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reason for override (required)"
            aria-label="Override notes"
            className="h-10 min-w-48 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={saveOverride}
            disabled={saving}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save override"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Leave both score and total blank to clear an override and fall back to the automatic
          score.
        </p>
      </div>
    </div>
  );
}
