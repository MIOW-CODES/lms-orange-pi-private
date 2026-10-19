import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, FileSpreadsheet, Pencil, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
  listCourses,
  listQuestionBank,
  listQuizzes,
  updateQuestion,
  type QuestionBankQuestion,
} from "@/lib/lms";
import {
  AppShell,
  Badge,
  Card,
  EmptyState,
  LoadError,
  staffNav,
  useProfile,
} from "@/components/lms";
import { compareWorksheetOrder } from "@/lib/question-bank-groups";
import { courseLevelLabel } from "@/lib/course-levels";
import { cn } from "@/lib/utils";
import { buildXlsx, downloadBlob, downloadCsv, type XlsxCell } from "@/lib/xlsx";

/** One worksheet summary chip — derived from the bank rows themselves. */
interface WorksheetSummary {
  quiz_id: string;
  title: string;
  course_code: string | null;
  archived: boolean;
  created_at: string | null;
  count: number;
}

interface EditForm {
  question: string;
  options: string[];
  correct_answer: string;
  lab_task: boolean;
  required: boolean;
}

const formFromRow = (r: QuestionBankQuestion): EditForm => ({
  question: r.question,
  options: [...r.options],
  correct_answer: r.correct_answer,
  lab_task: r.lab_task,
  required: r.required,
});

const cellInput =
  "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * Question bank table: every quiz question with course context, filterable by
 * course and worksheet, searchable, with inline editing of the stem, options,
 * answer key and flags. Includes answer keys — staff-only.
 *
 * Pass `courseId` to lock the bank to one course (course-workspace embed); the
 * course selector is then hidden and the rows load scoped to that course.
 */
export function QuestionBank({
  courseId: fixedCourseId,
  enabled = true,
}: {
  /** Lock the bank to one course and hide the course selector. */
  courseId?: string;
  /** Gate data fetching (the standalone page waits for the staff profile). */
  enabled?: boolean;
}) {
  const qc = useQueryClient();
  const showCourseFilter = !fixedCourseId;

  const { data: courses, isError: coursesFailed } = useQuery({
    queryKey: ["courses"],
    queryFn: listCourses,
    enabled: enabled && showCourseFilter,
  });
  const { data: quizzes, isError: quizzesFailed } = useQuery({
    queryKey: ["quizzes"],
    queryFn: listQuizzes,
    enabled,
  });
  const {
    data: rows,
    isLoading,
    isError: rowsFailed,
  } = useQuery({
    queryKey: fixedCourseId ? ["question-bank", fixedCourseId] : ["question-bank"],
    queryFn: () => listQuestionBank(fixedCourseId),
    enabled,
  });
  // Any failed load ends the loading state with a visible error + retry —
  // otherwise a rejected server call left this page on "Loading questions…" /
  // a misleading empty state forever.
  const loadFailed = coursesFailed || quizzesFailed || rowsFailed;
  const retryLoads = () => {
    qc.invalidateQueries({ queryKey: ["courses"] });
    qc.invalidateQueries({ queryKey: ["quizzes"] });
    qc.invalidateQueries({ queryKey: ["question-bank"] });
  };

  const [courseFilter, setCourseFilter] = useState(""); // "" = all courses
  const courseId = fixedCourseId ?? courseFilter;
  const [quizId, setQuizId] = useState(""); // "" = all worksheets
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  // Title fallback for rows whose view columns predate the worksheet-context
  // migration; ordering/soft-delete state comes from the question_bank view.
  const quizById = useMemo(() => {
    const m = new Map<string, string>();
    (quizzes ?? []).forEach((q) => m.set(q.id, q.title));
    return m;
  }, [quizzes]);

  // All rows in scope (the fixed course, or every course on the standalone
  // page). Questions on archived (soft-deleted) worksheets stay visible —
  // badged and sorted last — so per-worksheet coverage is complete at a glance.
  const courseRows = useMemo(
    () => (rows ?? []).filter((r) => !courseId || r.course_id === courseId),
    [rows, courseId],
  );

  // One chip per worksheet with its question count — drives the summary strip
  // and the group order so chips and group headers always agree.
  const worksheets = useMemo(() => {
    const map = new Map<string, WorksheetSummary>();
    for (const r of courseRows) {
      const title = (r.quiz_title ?? "").trim() || quizById.get(r.quiz_id) || "Worksheet";
      const w = map.get(r.quiz_id) ?? {
        quiz_id: r.quiz_id,
        title,
        course_code: r.course_code,
        archived: !!r.quiz_deleted_at,
        created_at: r.quiz_created_at,
        count: 0,
      };
      w.count += 1;
      map.set(r.quiz_id, w);
    }
    return [...map.values()].sort(compareWorksheetOrder);
  }, [courseRows, quizById]);

  const worksheetOrder = useMemo(() => {
    const m = new Map<string, number>();
    worksheets.forEach((w, i) => m.set(w.quiz_id, i));
    return m;
  }, [worksheets]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return courseRows
      .filter((r) => !quizId || r.quiz_id === quizId)
      .filter(
        (r) =>
          !q ||
          r.question.toLowerCase().includes(q) ||
          r.options.some((o) => o.toLowerCase().includes(q)) ||
          r.correct_answer.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const t = (worksheetOrder.get(a.quiz_id) ?? 0) - (worksheetOrder.get(b.quiz_id) ?? 0);
        return t !== 0 ? t : a.position - b.position;
      });
  }, [courseRows, quizId, search, worksheetOrder]);

  const exportRows = useMemo<XlsxCell[][]>(() => {
    const header = [
      "Course",
      "Worksheet",
      "Position",
      "Question",
      "Options",
      "Answer Key",
      "Lab Task",
      "Required",
    ];
    return [
      header,
      ...visible.map((r) => [
        r.course_code ?? "",
        r.quiz_title ?? quizById.get(r.quiz_id) ?? "Worksheet",
        r.position,
        r.question,
        r.options.join(" | "),
        r.correct_answer,
        r.lab_task ? "Yes" : "No",
        r.required ? "Yes" : "No",
      ]),
    ];
  }, [visible, quizById]);

  const exportCsv = () => {
    downloadCsv(exportRows, "miow-question-bank.csv");
    toast.success("Question bank CSV exported.");
  };
  const exportXlsx = () => {
    downloadBlob(
      buildXlsx([{ name: "Question Bank", rows: exportRows }]),
      "miow-question-bank.xlsx",
    );
    toast.success("Question bank Excel file exported.");
  };

  // Grouped by worksheet — a header row whenever the quiz changes.
  const groups = useMemo(() => {
    const out: Array<{
      quiz_id: string;
      title: string;
      course_code: string | null;
      archived: boolean;
      rows: QuestionBankQuestion[];
    }> = [];
    visible.forEach((r) => {
      const last = out[out.length - 1];
      if (last && last.quiz_id === r.quiz_id) last.rows.push(r);
      else
        out.push({
          quiz_id: r.quiz_id,
          title: (r.quiz_title ?? "").trim() || quizById.get(r.quiz_id) || "Worksheet",
          course_code: r.course_code,
          archived: !!r.quiz_deleted_at,
          rows: [r],
        });
    });
    return out;
  }, [visible, quizById]);

  // Reset the quiz filter when it no longer belongs to the selected course.
  useEffect(() => {
    if (quizId && !worksheets.some((w) => w.quiz_id === quizId)) setQuizId("");
  }, [worksheets, quizId]);

  const startEdit = (r: QuestionBankQuestion) => {
    setEditingId(r.id);
    setForm(formFromRow(r));
  };
  const cancelEdit = () => {
    setEditingId(null);
    setForm(null);
  };

  const saveRow = async (r: QuestionBankQuestion) => {
    if (!form) return;
    const question = form.question.trim();
    const options = form.options.map((o) => o.trim());
    const correct_answer = form.correct_answer.trim();
    if (!question) {
      toast.error("Question text cannot be empty.");
      return;
    }
    if (options.some((o) => o === "")) {
      toast.error("Options cannot be empty — remove unused ones.");
      return;
    }
    if (r.question_type === "multiple_choice" && options.length !== 4) {
      toast.error("Multiple-choice questions must have exactly four options (A–D).");
      return;
    }
    if (options.length > 12) {
      toast.error("At most 12 options.");
      return;
    }
    if (!correct_answer) {
      toast.error("Provide the correct answer (or rubric).");
      return;
    }

    setSaving(true);
    try {
      await updateQuestion(r.id, {
        question,
        options,
        correct_answer,
        lab_task: form.lab_task,
        required: form.required,
      });
      toast.success("Question updated.");
      cancelEdit();
      qc.invalidateQueries({ queryKey: ["question-bank"] });
    } catch {
      toast.error("Could not update the question.");
    } finally {
      setSaving(false);
    }
  };

  const setOption = (idx: number, value: string) =>
    setForm((f) => (f ? { ...f, options: f.options.map((o, i) => (i === idx ? value : o)) } : f));
  const addOption = () => setForm((f) => (f ? { ...f, options: [...f.options, ""] } : f));
  const removeOption = (idx: number) =>
    setForm((f) => (f ? { ...f, options: f.options.filter((_, i) => i !== idx) } : f));

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-3">
        {showCourseFilter && (
          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            aria-label="Filter by course"
            className="h-11 min-w-56 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All courses</option>
            {(courses ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title} ({courseLevelLabel(c)})
              </option>
            ))}
          </select>
        )}
        <select
          value={quizId}
          onChange={(e) => setQuizId(e.target.value)}
          aria-label="Filter by worksheet"
          className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All worksheets</option>
          {worksheets.map((w) => (
            <option key={w.quiz_id} value={w.quiz_id}>
              {w.title}
              {w.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search questions"
            placeholder="Search question, option or answer..."
            className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={exportCsv}
            disabled={!visible.length}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
          <button
            onClick={exportXlsx}
            disabled={!visible.length}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </button>
        </div>
      </div>

      {/* Worksheet summary strip — one chip per worksheet with its question
          count so coverage is obvious at a glance; clicking a chip filters the
          table to that worksheet (click again to clear). */}
      {worksheets.length > 0 && (
        <div
          className="mb-5 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Worksheets"
        >
          <button
            type="button"
            onClick={() => setQuizId("")}
            aria-pressed={!quizId}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
              !quizId
                ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
                : "border-border/60 bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            All worksheets
            <span
              className={cn(
                "rounded-full px-1.5 text-[11px]",
                !quizId ? "bg-primary-foreground/20" : "bg-background/70",
              )}
            >
              {courseRows.length}
            </span>
          </button>
          {worksheets.map((w) => {
            const active = quizId === w.quiz_id;
            return (
              <button
                key={w.quiz_id}
                type="button"
                onClick={() => setQuizId(active ? "" : w.quiz_id)}
                aria-pressed={active}
                title={`${w.title} — ${w.count} question${w.count === 1 ? "" : "s"}${w.archived ? " (archived worksheet)" : ""}`}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
                    : "border-border/60 bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="max-w-[14rem] truncate">{w.title}</span>
                <span>· {w.count}</span>
                {w.archived && <Badge tone="slate">Archived</Badge>}
              </button>
            );
          })}
        </div>
      )}

      {loadFailed ? (
        <LoadError what="the question bank" onRetry={retryLoads} />
      ) : isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading questions…</Card>
      ) : groups.length === 0 ? (
        <EmptyState
          title="No questions found"
          sub={
            search || courseId || quizId
              ? showCourseFilter
                ? "Try a different course, worksheet or search term."
                : "Try a different worksheet or search term."
              : "Questions appear here as soon as worksheets are created."
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-4">Question</th>
                <th className="p-4">Type</th>
                <th className="p-4">Answer Key</th>
                <th className="p-4">Flags</th>
                <th className="p-4" aria-label="Actions" />
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.quiz_id} className="divide-y divide-border">
                <tr className="bg-muted/40">
                  <td colSpan={5} className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{g.title}</span>
                      {g.course_code && <Badge tone="slate">{g.course_code}</Badge>}
                      {g.archived && <Badge tone="amber">Archived worksheet</Badge>}
                      <span className="text-xs text-muted-foreground">
                        {g.rows.length} question{g.rows.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </td>
                </tr>
                {g.rows.map((r) =>
                  editingId === r.id && form ? (
                    <tr key={r.id}>
                      <td colSpan={5} className="p-4">
                        <div className="grid gap-3">
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Question
                            </span>
                            <textarea
                              value={form.question}
                              onChange={(e) => setForm({ ...form, question: e.target.value })}
                              rows={2}
                              maxLength={2000}
                              className="w-full rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                            />
                          </label>

                          {form.options.length > 0 ? (
                            <div className="flex flex-col gap-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Options (answer key must match one of these)
                              </span>
                              {form.options.map((o, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <input
                                    value={o}
                                    onChange={(e) => setOption(i, e.target.value)}
                                    placeholder={`Option ${i + 1}`}
                                    aria-label={`Option ${i + 1}`}
                                    className={cn(cellInput, "h-10")}
                                  />
                                  <button
                                    onClick={() => removeOption(i)}
                                    aria-label={`Remove option ${i + 1}`}
                                    className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-rose-600 dark:hover:text-rose-400"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              ))}
                              {form.options.length < 12 && (
                                <button
                                  onClick={addOption}
                                  className="flex w-fit items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-muted"
                                >
                                  <Plus className="h-3.5 w-3.5" /> Add option
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>Essay / lab task — no options.</span>
                              <button
                                onClick={addOption}
                                className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
                              >
                                <Plus className="h-3.5 w-3.5" /> Add options
                              </button>
                            </div>
                          )}

                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Correct answer
                              {form.options.length === 0 && " (essay: “Rubric: …”)"}
                            </span>
                            <input
                              value={form.correct_answer}
                              onChange={(e) => setForm({ ...form, correct_answer: e.target.value })}
                              maxLength={1000}
                              className="h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                            />
                          </label>

                          <div className="flex flex-wrap items-center gap-4">
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={form.lab_task}
                                onChange={(e) => setForm({ ...form, lab_task: e.target.checked })}
                                className="h-4 w-4 rounded border-input"
                              />
                              Lab task (Arduino lab embed)
                            </label>
                            <span className="text-xs text-muted-foreground">
                              Simulation questions must include a breadboard wiring task.
                            </span>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={form.required}
                                onChange={(e) => setForm({ ...form, required: e.target.checked })}
                                className="h-4 w-4 rounded border-input"
                              />
                              Required (never dropped from a draw)
                            </label>
                          </div>

                          <div className="flex justify-end gap-2">
                            <button
                              onClick={cancelEdit}
                              className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-muted"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => saveRow(r)}
                              disabled={saving}
                              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                            >
                              <Check className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={r.id}>
                      <td className="p-4">
                        <p className="font-medium">{r.question}</p>
                        {r.image_url && (
                          <p className="mt-1 text-xs text-muted-foreground">Has image</p>
                        )}
                      </td>
                      <td className="p-4">
                        {r.options.length > 0 ? (
                          <Badge tone="indigo">{r.options.length} options</Badge>
                        ) : r.lab_task ? (
                          <Badge tone="amber">Lab task</Badge>
                        ) : (
                          <Badge tone="slate">Essay</Badge>
                        )}
                      </td>
                      <td className="p-4">
                        <span
                          className="line-clamp-2 text-muted-foreground"
                          title={r.correct_answer}
                        >
                          {r.correct_answer}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1">
                          {r.required && <Badge tone="violet">Required</Badge>}
                          {r.lab_task && <Badge tone="amber">Lab</Badge>}
                          {!r.required && !r.lab_task && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => startEdit(r)}
                          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-muted"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            ))}
          </table>
        </Card>
      )}
    </div>
  );
}

/**
 * Staff question bank page: every quiz question across the staff member's
 * courses, with answer keys. Wraps the reusable bank table in the app shell.
 */
export function QuestionBankPage() {
  const profile = useProfile(["admin", "teacher"]);

  if (!profile) return null;

  return (
    <AppShell
      nav={staffNav(profile.role)}
      profile={profile}
      subtitle={profile.role === "admin" ? "MIOW Admin Console" : "MIOW Teacher Portal"}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Question Bank</h1>
      </div>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Every worksheet question across your courses, with answer keys. Edit stems, options, answer
        keys and flags in place — changes apply to the live worksheet immediately.
      </p>
      <QuestionBank enabled={!!profile} />
    </AppShell>
  );
}
