import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Plus, Save, Trash2, Wand2, X } from "lucide-react";
import { courseLevelLabel } from "@/lib/course-levels";
import { toast } from "sonner";
import {
  deleteTos,
  listCourseTos,
  listQuestionBank,
  listCourses,
  listQuizzes,
  termLabel,
  termOptions,
  upsertTos,
  type CognitiveLevel,
  type Course,
  type TosItem,
} from "@/lib/lms";
import {
  AppShell,
  Card,
  EmptyState,
  LoadError,
  Modal,
  staffNav,
  useProfile,
} from "@/components/lms";
import { cn } from "@/lib/utils";
import { buildXlsx, downloadBlob, downloadCsv, type XlsxCell } from "@/lib/xlsx";

/** Bloom's taxonomy levels allowed for a TOS item (mirrors the server enum). */
const COGNITIVE_LEVELS: CognitiveLevel[] = [
  "remembering",
  "understanding",
  "applying",
  "analyzing",
  "evaluating",
  "creating",
];

const COGNITIVE_LABEL: Record<CognitiveLevel, string> = {
  remembering: "Remembering",
  understanding: "Understanding",
  applying: "Applying",
  analyzing: "Analyzing",
  evaluating: "Evaluating",
  creating: "Creating",
};

const ORDINAL_QUARTER = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
];

/**
 * Best-effort quarter tokens from a worksheet title ("Q2", "Quarter 2",
 * "2nd Quarter", "Part 2", "Second Quarter"). Empty = no signal.
 */
function quizQuarterTokens(title: string): number[] {
  const t = title.toLowerCase();
  const out: number[] = [];
  for (let n = 1; n <= 8; n++) {
    if (
      new RegExp(`\\bq${n}\\b`).test(t) ||
      new RegExp(`\\bquarter\\s*${n}\\b`).test(t) ||
      new RegExp(`\\b${n}(st|nd|rd|th)\\s+quarter\\b`).test(t) ||
      new RegExp(`\\bpart\\s*${n}\\b`).test(t) ||
      new RegExp(`\\b${ORDINAL_QUARTER[n - 1]}\\s+quarter\\b`).test(t)
    ) {
      out.push(n);
    }
  }
  return out;
}

const emptyItem = (): TosItem => ({
  topic: "",
  no_of_items: 1,
  cognitive_level: "understanding",
  quiz_id: null,
  note: null,
});

const cellInput =
  "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * Table of Specifications editor for one course. Renders the course selector
 * only when `courses` + `onCourseChange` are provided (the course workspace
 * already knows its course); the quarter selector is always shown.
 */
export function TosView({
  course,
  courses,
  onCourseChange,
}: {
  course: Course;
  courses?: Course[];
  onCourseChange?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [quarter, setQuarter] = useState(1);
  const [draft, setDraft] = useState<{ title: string; items: TosItem[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genSelected, setGenSelected] = useState<Set<string>>(new Set());

  const {
    data: tosRows,
    isLoading: tosLoading,
    isError: tosFailed,
    refetch: refetchTos,
  } = useQuery({
    queryKey: ["course-tos", course.id],
    queryFn: () => listCourseTos(course.id),
    enabled: !!course.id,
  });
  const { data: quizzes } = useQuery({ queryKey: ["quizzes"], queryFn: listQuizzes });
  const { data: questionBank } = useQuery({
    queryKey: ["question-bank", course.id],
    queryFn: () => listQuestionBank(course.id),
    enabled: !!course.id,
  });

  const terms = termOptions(course);
  const existing = useMemo(
    () => (tosRows ?? []).find((t) => t.quarter === quarter) ?? null,
    [tosRows, quarter],
  );

  // Live worksheets for this course (soft-deleted rows are already excluded by
  // listQuizzes, and the question-bank rows are filtered against them below).
  const courseQuizzes = useMemo(
    () => (quizzes ?? []).filter((q) => q.course_id === course.id),
    [quizzes, course.id],
  );
  const liveQuizIds = useMemo(() => new Set(courseQuizzes.map((q) => q.id)), [courseQuizzes]);
  const questionCountByQuiz = useMemo(() => {
    const counts = new Map<string, number>();
    (questionBank ?? []).forEach((r) => {
      if (!liveQuizIds.has(r.quiz_id)) return; // drops soft-deleted quizzes
      counts.set(r.quiz_id, (counts.get(r.quiz_id) ?? 0) + 1);
    });
    return counts;
  }, [questionBank, liveQuizIds]);

  // Keep the term inside the course's term set (K-12 vs college differ).
  useEffect(() => {
    if (!terms.includes(quarter)) setQuarter(terms[0] ?? 1);
  }, [terms, quarter]);

  // Load the saved TOS into the editor (unless there are unsaved edits).
  useEffect(() => {
    if (dirty) return;
    setDraft(
      existing
        ? { title: existing.title ?? "", items: existing.items.map((i) => ({ ...i })) }
        : null,
    );
  }, [existing, dirty]);

  useEffect(() => {
    setDirty(false);
  }, [course.id, quarter]);

  const setItem = (idx: number, patch: Partial<TosItem>) => {
    setDirty(true);
    setDraft((d) =>
      d ? { ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) } : d,
    );
  };
  const addItem = () => {
    setDirty(true);
    setDraft((d) => ({ title: d?.title ?? "", items: [...(d?.items ?? []), emptyItem()] }));
  };
  const removeItem = (idx: number) => {
    setDirty(true);
    setDraft((d) => (d ? { ...d, items: d.items.filter((_, i) => i !== idx) } : d));
  };

  const save = async () => {
    if (!course.id) return;
    const items = (draft?.items ?? []).map((it) => ({
      ...it,
      topic: it.topic.trim(),
      no_of_items: Math.max(0, Math.min(1000, Math.round(it.no_of_items) || 0)),
      note: it.note?.trim() ? it.note.trim().slice(0, 2000) : null,
    }));
    if (items.some((it) => it.topic === "")) {
      toast.error("Every row needs a topic.");
      return;
    }
    setSaving(true);
    try {
      await upsertTos({
        ...(existing ? { id: existing.id } : {}),
        courseId: course.id,
        quarter,
        title: draft?.title.trim() ? draft.title.trim().slice(0, 300) : null,
        items,
      });
      toast.success(`TOS saved for ${termLabel(quarter, course)}.`);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["course-tos", course.id] });
    } catch {
      toast.error("Could not save the TOS.");
    } finally {
      setSaving(false);
    }
  };

  const removeTos = async () => {
    if (!existing) return;
    setSaving(true);
    try {
      await deleteTos(existing.id);
      toast.success("TOS deleted.");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["course-tos", course.id] });
    } catch {
      toast.error("Could not delete the TOS.");
    } finally {
      setSaving(false);
    }
  };

  const exportRows: XlsxCell[][] = [
    [
      "Course",
      "Quarter",
      "TOS Title",
      "Topic",
      "No. of Items",
      "Cognitive Level",
      "Linked Quiz",
      "Note",
    ],
    ...(draft?.items ?? []).map((item) => [
      course.code,
      termLabel(quarter, course),
      draft?.title ?? "",
      item.topic,
      item.no_of_items,
      COGNITIVE_LABEL[item.cognitive_level],
      courseQuizzes.find((q) => q.id === item.quiz_id)?.title ?? "",
      item.note ?? "",
    ]),
  ];
  const exportCsv = () => {
    downloadCsv(exportRows, `${course.code}-tos-Q${quarter}.csv`);
    toast.success("TOS CSV exported.");
  };
  const exportXlsx = () => {
    downloadBlob(
      buildXlsx([{ name: "TOS", rows: exportRows }]),
      `${course.code}-tos-Q${quarter}.xlsx`,
    );
    toast.success("TOS Excel file exported.");
  };

  const openGenerate = () => {
    const preselected = new Set(
      courseQuizzes
        .filter((q) => {
          const tokens = quizQuarterTokens(q.title);
          return tokens.length === 0 || tokens.includes(quarter);
        })
        .map((q) => q.id),
    );
    setGenSelected(preselected);
    setGenOpen(true);
  };

  const generate = async () => {
    const picked = courseQuizzes.filter((q) => genSelected.has(q.id));
    if (picked.length === 0) {
      toast.error("Pick at least one worksheet.");
      return;
    }
    const items: TosItem[] = picked.map((q) => ({
      topic: q.title,
      no_of_items: questionCountByQuiz.get(q.id) ?? 0,
      cognitive_level: "understanding",
      quiz_id: q.id,
      note: null,
    }));
    setSaving(true);
    try {
      await upsertTos({
        courseId: course.id,
        quarter,
        title: existing?.title ?? `Quarter ${quarter} — Table of Specifications`,
        items,
      });
      toast.success(
        `Generated ${items.length} TOS item${items.length === 1 ? "" : "s"} from ${picked.length} worksheet${picked.length === 1 ? "" : "s"}. Review and save.`,
      );
      setGenOpen(false);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["course-tos", course.id] });
    } catch {
      toast.error("Could not generate the TOS.");
    } finally {
      setSaving(false);
    }
  };

  const quizTitle = (id: string | null) =>
    id ? (courseQuizzes.find((q) => q.id === id)?.title ?? "—") : "—";

  const totalItems = (draft?.items ?? []).reduce((sum, it) => sum + (it.no_of_items || 0), 0);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {onCourseChange && courses && (
          <select
            value={course.id}
            onChange={(e) => onCourseChange(e.target.value)}
            aria-label="Select course"
            className="h-11 min-w-56 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title} ({courseLevelLabel(c)})
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {terms.map((q) => (
            <button
              key={q}
              onClick={() => setQuarter(q)}
              className={cn(
                "rounded-lg px-3 py-2 text-xs font-semibold sm:text-sm",
                quarter === q ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              {termLabel(q, course)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {!existing && courseQuizzes.length > 0 && (
            <button
              onClick={openGenerate}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              <Wand2 className="h-4 w-4" /> Generate from quizzes
            </button>
          )}
          <button
            onClick={addItem}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted"
          >
            <Plus className="h-4 w-4" /> Row
          </button>
          {existing && (
            <button
              onClick={removeTos}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-muted disabled:opacity-50 dark:text-rose-400"
            >
              <Trash2 className="h-4 w-4" /> Delete TOS
            </button>
          )}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={exportCsv}
            disabled={!draft?.items.length}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
          <button
            onClick={exportXlsx}
            disabled={!draft?.items.length}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </button>
        </div>
      </div>

      <Card className="mb-5 p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Title
          </span>
          <input
            value={draft?.title ?? ""}
            onChange={(e) => {
              setDirty(true);
              setDraft((d) => ({ title: e.target.value, items: d?.items ?? [] }));
            }}
            placeholder={`Quarter ${quarter} — Table of Specifications`}
            aria-label="TOS title"
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </Card>

      {tosFailed ? (
        <LoadError what="this course's TOS" onRetry={() => void refetchTos()} />
      ) : tosLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading TOS…</Card>
      ) : !draft || draft.items.length === 0 ? (
        <EmptyState
          title={`No TOS items for ${termLabel(quarter, course)} yet`}
          sub={
            courseQuizzes.length > 0
              ? "Add rows manually, or generate items from this term's worksheets."
              : "Add rows to build the Table of Specifications."
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-4">Topic</th>
                <th className="p-4 text-center">No. of Items</th>
                <th className="p-4">Cognitive Level</th>
                <th className="p-4">Linked Quiz</th>
                <th className="p-4">Note</th>
                <th className="p-4" aria-label="Row actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {draft.items.map((it, idx) => (
                <tr key={idx}>
                  <td className="p-3">
                    <input
                      value={it.topic}
                      onChange={(e) => setItem(idx, { topic: e.target.value })}
                      placeholder="Topic"
                      aria-label={`Topic of row ${idx + 1}`}
                      className={cellInput}
                    />
                  </td>
                  <td className="p-3 text-center">
                    <input
                      value={it.no_of_items}
                      onChange={(e) =>
                        setItem(idx, {
                          no_of_items: sanitizeCount(e.target.value),
                        })
                      }
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={`Number of items of row ${idx + 1}`}
                      className={cn(cellInput, "w-20 text-center")}
                    />
                  </td>
                  <td className="p-3">
                    <select
                      value={it.cognitive_level}
                      onChange={(e) =>
                        setItem(idx, { cognitive_level: e.target.value as CognitiveLevel })
                      }
                      aria-label={`Cognitive level of row ${idx + 1}`}
                      className={cellInput}
                    >
                      {COGNITIVE_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {COGNITIVE_LABEL[lvl]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <select
                      value={it.quiz_id ?? ""}
                      onChange={(e) => setItem(idx, { quiz_id: e.target.value || null })}
                      aria-label={`Linked quiz of row ${idx + 1}`}
                      className={cellInput}
                    >
                      <option value="">Not linked</option>
                      {courseQuizzes.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.title}
                        </option>
                      ))}
                    </select>
                    {it.quiz_id && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {questionCountByQuiz.get(it.quiz_id) ?? 0} live questions
                      </p>
                    )}
                  </td>
                  <td className="p-3">
                    <input
                      value={it.note ?? ""}
                      onChange={(e) => setItem(idx, { note: e.target.value })}
                      placeholder="—"
                      aria-label={`Note of row ${idx + 1}`}
                      className={cellInput}
                    />
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => removeItem(idx)}
                      aria-label={`Remove row ${idx + 1}`}
                      className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-rose-600 dark:hover:text-rose-400"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border text-xs font-semibold text-muted-foreground">
                <td className="p-4">Total</td>
                <td className="p-4 text-center">{totalItems}</td>
                <td className="p-4" colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      <Modal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title={`Generate TOS from worksheets — ${termLabel(quarter, course)}`}
      >
        <p className="text-sm text-muted-foreground">
          Pick the worksheets that belong to this term. Each one becomes a TOS row (topic =
          worksheet title, items = live question count). You can refine everything after generating.
        </p>
        <div className="mt-4 space-y-2">
          {courseQuizzes.map((q) => (
            <label
              key={q.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3 py-2.5 transition hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={genSelected.has(q.id)}
                onChange={(e) => {
                  setGenSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(q.id);
                    else next.delete(q.id);
                    return next;
                  });
                }}
                className="h-4 w-4 rounded border-input"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{q.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {questionCountByQuiz.get(q.id) ?? 0} live questions
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => setGenOpen(false)}
            className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={generate}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" /> {saving ? "Generating…" : "Generate"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** Numeric draft values are kept as-is while typing; empty means 0 on save. */
function sanitizeCount(value: string): number {
  const digits = value.replace(/[^0-9]/g, "").slice(0, 4);
  return digits === "" ? 0 : Number(digits);
}

/** Full-page TOS route body (teacher + admin): course picker + TosView. */
export function TosPage() {
  const profile = useProfile(["admin", "teacher"]);
  const {
    data: courses,
    isError: coursesFailed,
    refetch: refetchCourses,
  } = useQuery({
    queryKey: ["courses"],
    queryFn: listCourses,
    enabled: !!profile,
  });
  const [courseId, setCourseId] = useState("");

  useEffect(() => {
    if (!courseId && courses?.length) setCourseId(courses[0]?.id ?? "");
  }, [courses, courseId]);

  if (!profile) return null;

  const course = (courses ?? []).find((c) => c.id === courseId) ?? null;

  return (
    <AppShell
      nav={staffNav(profile.role)}
      profile={profile}
      subtitle={profile.role === "admin" ? "MIOW Admin Console" : "MIOW Teacher Portal"}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Table of Specifications</h1>
      </div>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Map each term's topics to item counts and cognitive levels, and link topics to the
        worksheets they draw from. Saved per course and term.
      </p>

      {!course ? (
        coursesFailed ? (
          <LoadError what="your courses" onRetry={() => void refetchCourses()} />
        ) : courses === undefined ? (
          <Card className="p-6 text-sm text-muted-foreground">Loading courses…</Card>
        ) : (
          <EmptyState title="No courses yet" sub="Create a course before building a TOS." />
        )
      ) : (
        <TosView course={course} courses={courses ?? []} onCourseChange={setCourseId} />
      )}
    </AppShell>
  );
}
