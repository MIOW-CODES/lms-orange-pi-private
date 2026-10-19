import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardPaste,
  FileUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  bulkAddStudents,
  enrollmentsForCourse,
  listCourseMeetings,
  listCourses,
  listStudents,
  type BulkAddResult,
  type BulkStudentRow,
  type Course,
  type CourseMeeting,
} from "@/lib/lms";
import {
  parseClassList,
  reviewClassList,
  validateClassListRow,
  type ReviewRow,
} from "@/lib/class-list";
import { Badge, Card, Modal } from "@/components/lms";
import { GRADE_LEVELS } from "@/components/courses/constants";
import { cn, gradeLevelLabel } from "@/lib/utils";

type Step = "paste" | "review" | "done";

const AVATAR = (seed: string) =>
  `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(seed)}`;

const PLACEHOLDER = `Paste your class list here — from a spreadsheet, Word doc or PDF.

2024-2699, ACOSTA, Axel Rose V., F, 3
2024-2712, AMEROL, Jenan M., F, 3
2023-1550, BUSANO, JOHN DALE S., M, 4

Tabs, commas or spaces all work. A header row is fine.
Student number · Name · Gender · Year — extra columns are okay.`;

/* ------------------------------------------------------------------ */
/* Small pieces                                                         */
/* ------------------------------------------------------------------ */

function SummaryChip({
  tone,
  label,
  value,
  delay,
}: {
  tone: "green" | "indigo" | "red" | "amber";
  label: string;
  value: number;
  delay: number;
}) {
  const tones = {
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    indigo: "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
    red: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: "easeOut" }}
      className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5", tones[tone])}
    >
      <span className="font-display text-lg font-bold leading-none">{value}</span>
      <span className="text-xs font-semibold">{label}</span>
    </motion.div>
  );
}

function TargetBar({
  courses,
  courseLocked,
  courseLabel,
  courseId,
  onCourse,
  meetings,
  meetingId,
  onMeeting,
  compact,
}: {
  courses: Course[];
  courseLocked: boolean;
  courseLabel?: string;
  courseId: string;
  onCourse: (id: string) => void;
  meetings: CourseMeeting[];
  meetingId: string;
  onMeeting: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-muted/40",
        compact ? "flex flex-wrap items-center gap-3 px-4 py-3" : "p-4",
      )}
    >
      {!compact && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Add these students to
        </p>
      )}
      <div className={cn("flex flex-wrap items-center gap-2", compact && "flex-1")}>
        {courseLocked ? (
          <span className="flex h-10 items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 text-sm font-semibold">
            <Users className="h-4 w-4 text-primary" />
            {courseLabel || "This course"}
          </span>
        ) : (
          <select
            value={courseId}
            onChange={(e) => onCourse(e.target.value)}
            aria-label="Course to enroll into"
            className="h-10 max-w-64 flex-1 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">No course — just add students</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ? `${c.code} · ${c.title}` : c.title}
              </option>
            ))}
          </select>
        )}
        <select
          value={meetingId}
          onChange={(e) => onMeeting(e.target.value)}
          disabled={!courseId || meetings.length === 0}
          aria-label="Meeting (lecture or lab) to assign"
          className="h-10 flex-1 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <option value="">
            {meetings.length === 0 ? "No meetings for this course" : "Course only — no meeting yet"}
          </option>
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · {m.kind === "lab" ? "Lab" : "Lecture"}
            </option>
          ))}
        </select>
      </div>
      {!compact && (
        <p className="mt-2 text-xs text-muted-foreground">
          Everyone you add is enrolled in the course above. Picking a meeting also puts them in that
          lecture or lab.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main content                                                         */
/* ------------------------------------------------------------------ */

export function BulkAddStudentsContent({
  onClose,
  courseId: initialCourseId = "",
  courseLabel,
  courseLocked = false,
  onDone,
}: {
  onClose: () => void;
  courseId?: string;
  courseLabel?: string;
  courseLocked?: boolean;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [courseId, setCourseId] = useState(initialCourseId);
  const [meetingId, setMeetingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<BulkAddResult | null>(null);
  const [skipped, setSkipped] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: courses } = useQuery({ queryKey: ["courses"], queryFn: listCourses });
  const { data: students } = useQuery({ queryKey: ["students"], queryFn: listStudents });
  const { data: meetings } = useQuery({
    queryKey: ["course-meetings", courseId],
    queryFn: () => listCourseMeetings(courseId),
    enabled: !!courseId,
  });
  const { data: enrolledIds } = useQuery({
    queryKey: ["enrollments", courseId],
    queryFn: () => enrollmentsForCourse(courseId),
    enabled: !!courseId,
  });

  useEffect(() => {
    if (step === "paste") textareaRef.current?.focus();
  }, [step]);

  const existing = useMemo(() => students ?? [], [students]);
  const enrolled = useMemo(() => new Set(enrolledIds ?? []), [enrolledIds]);

  const stats = useMemo(() => {
    let fresh = 0;
    let known = 0;
    let broken = 0;
    let repeated = 0;
    for (const r of rows) {
      if (r.status === "invalid") broken++;
      else if (r.status === "duplicate") repeated++;
      else if (r.status === "new") fresh++;
      else known++;
    }
    return { fresh, known, broken, repeated };
  }, [rows]);

  const included = rows.filter((r) => r.include);

  /* ---------- parse & review ---------- */

  const preview = (raw?: string) => {
    const source = (raw ?? text).trim();
    if (!source) return;
    const parsed = parseClassList(source);
    if (!parsed.rows.length) {
      toast.error("Couldn't find student rows in that text.");
      return;
    }
    const reviewed = reviewClassList(parsed.rows, {
      existing,
      enrolledIds: enrolled,
    });
    setText(raw ?? text);
    setRows(reviewed);
    setNotes(parsed.notes);
    setStep("review");
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      toast.error("Export the spreadsheet as CSV first — .xlsx files aren't supported yet.");
      return;
    }
    try {
      const raw = await file.text();
      const parsed = parseClassList(raw);
      if (!parsed.rows.length) {
        setText(raw);
        toast.error("No student rows found in that file.");
        return;
      }
      preview(raw);
      toast.success(`Loaded ${parsed.rows.length} rows from ${file.name}.`);
    } catch {
      toast.error("That file couldn't be read.");
    }
  };

  /* ---------- row editing ---------- */

  const editRow = (key: string, patch: Partial<ReviewRow>) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.key === key ? { ...r, ...patch } : r));
      return refreshReview(next, existing, enrolled);
    });
  };

  const toggleAll = () => {
    const allIn = rows.every((r) => !r.include);
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        include: allIn ? r.status !== "invalid" && r.status !== "duplicate" : false,
      })),
    );
  };

  /* ---------- commit ---------- */

  const commit = async () => {
    if (!included.length) return;
    setSaving(true);
    try {
      const payload: BulkStudentRow[] = included.map((r) => ({
        full_name: r.full_name ?? "",
        student_id: r.student_id || null,
        email: r.email || null,
        grade_level: r.grade_level ?? null,
        section: r.section || null,
        avatar_url: r.student_id ? AVATAR(r.student_id) : null,
      }));
      // Chunked so a big list can never hit the server payload ceiling.
      let merged: BulkAddResult | null = null;
      for (let i = 0; i < payload.length; i += 300) {
        const part = await bulkAddStudents(payload.slice(i, i + 300), {
          courseId: courseId || null,
          meetingId: meetingId || null,
        });
        merged = merged
          ? {
              added: merged.added + part.added,
              linked: merged.linked + part.linked,
              enrolled: merged.enrolled + part.enrolled,
              meeting_added:
                merged.meeting_added == null || part.meeting_added == null
                  ? (merged.meeting_added ?? part.meeting_added)
                  : merged.meeting_added + part.meeting_added,
              rows: [...merged.rows, ...part.rows.map((r) => ({ ...r, index: r.index + i }))],
            }
          : part;
      }
      const finalResult = merged!;
      setResult(finalResult);
      setSkipped(rows.length - included.length);
      setStep("done");
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["enrollments"] });
      qc.invalidateQueries({ queryKey: ["course-meetings"] });
      qc.invalidateQueries({ queryKey: ["meeting-members"] });
      onDone?.();
      const failed = finalResult.rows.filter((r) => r.status === "failed").length;
      if (failed) toast.error(`Added with ${failed} failure${failed !== 1 ? "s" : ""}.`);
      else
        toast.success(
          `Added ${finalResult.added + finalResult.linked} student${
            finalResult.added + finalResult.linked !== 1 ? "s" : ""
          }.`,
        );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add these students.");
    } finally {
      setSaving(false);
    }
  };

  /* ---------- render ---------- */

  return (
    <div>
      <AnimatePresence mode="wait">
        {step === "paste" && (
          <motion.div
            key="paste"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="space-y-3"
          >
            <TargetBar
              courses={courses ?? []}
              courseLocked={courseLocked}
              {...(courseLabel ? { courseLabel } : {})}
              courseId={courseId}
              onCourse={(id) => {
                setCourseId(id);
                setMeetingId("");
              }}
              meetings={meetings ?? []}
              meetingId={meetingId}
              onMeeting={setMeetingId}
            />

            <div>
              <label
                htmlFor="bulk-paste"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Class list
              </label>
              <textarea
                id="bulk-paste"
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") preview();
                }}
                placeholder={PLACEHOLDER}
                spellCheck={false}
                className="custom-scrollbar h-64 w-full resize-y rounded-2xl border border-input bg-background/70 p-4 font-mono text-sm leading-6 outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                className="hidden"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted"
              >
                <FileUp className="h-4 w-4" /> Upload a file
              </button>
              <p className="text-xs text-muted-foreground">
                CSV or text files — no need to clean the list up first.
              </p>
              <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
                ⌘ / Ctrl + Enter to review
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="h-11 rounded-xl border border-border bg-card px-5 text-sm font-semibold hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => preview()}
                disabled={!text.trim()}
                className="flex h-11 items-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <ClipboardPaste className="h-4 w-4" /> Review students
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}

        {step === "review" && (
          <motion.div
            key="review"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="space-y-3"
          >
            <TargetBar
              compact
              courses={courses ?? []}
              courseLocked={courseLocked}
              {...(courseLabel ? { courseLabel } : {})}
              courseId={courseId}
              onCourse={(id) => {
                setCourseId(id);
                setMeetingId("");
              }}
              meetings={meetings ?? []}
              meetingId={meetingId}
              onMeeting={setMeetingId}
            />

            <div className="flex flex-wrap items-center gap-2">
              <SummaryChip tone="green" label="new" value={stats.fresh} delay={0} />
              <SummaryChip tone="indigo" label="already known" value={stats.known} delay={0.05} />
              {stats.broken > 0 && (
                <SummaryChip tone="red" label="need fixing" value={stats.broken} delay={0.1} />
              )}
              {stats.repeated > 0 && (
                <SummaryChip
                  tone="amber"
                  label="repeated in list"
                  value={stats.repeated}
                  delay={0.15}
                />
              )}
              <button
                type="button"
                onClick={toggleAll}
                className="ml-auto text-xs font-semibold text-primary hover:underline"
              >
                {rows.every((r) => !r.include) ? "Select all rows" : "Clear selection"}
              </button>
            </div>

            {notes.map((n) => (
              <p
                key={n}
                className="flex items-start gap-1.5 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {n}
              </p>
            ))}

            <Card className="custom-scrollbar overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="w-9 p-2.5">
                      <span className="sr-only">Include</span>
                    </th>
                    <th className="p-2.5">Student no.</th>
                    <th className="p-2.5">Name</th>
                    <th className="w-28 p-2.5">Grade</th>
                    <th className="p-2.5">Section</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => {
                    const bad = r.status === "invalid";
                    const warn = r.status === "duplicate";
                    return (
                      <tr
                        key={r.key}
                        className={cn(
                          "transition-colors",
                          bad && "bg-rose-500/[0.06]",
                          warn && "bg-amber-500/[0.06]",
                          !r.include && "opacity-50",
                        )}
                      >
                        <td className="p-2 pl-3 align-top">
                          <input
                            type="checkbox"
                            checked={r.include}
                            disabled={bad || warn}
                            onChange={(e) => editRow(r.key, { include: e.target.checked })}
                            aria-label={`Include ${r.full_name ?? `row ${r.line}`}`}
                            className="mt-2 h-4 w-4 accent-[var(--primary)]"
                          />
                        </td>
                        <td className="p-1.5 align-top">
                          <input
                            value={r.student_id ?? ""}
                            onChange={(e) => editRow(r.key, { student_id: e.target.value })}
                            aria-label={`Student number for ${r.full_name ?? `row ${r.line}`}`}
                            placeholder="—"
                            className="h-9 w-32 rounded-lg border border-transparent bg-transparent px-2 text-sm outline-none hover:border-input focus:border-input focus:bg-background"
                          />
                        </td>
                        <td className="p-1.5 align-top">
                          <input
                            value={r.full_name ?? ""}
                            onChange={(e) => editRow(r.key, { full_name: e.target.value })}
                            aria-label={`Name for row ${r.line}`}
                            placeholder="Name needed"
                            className={cn(
                              "h-9 w-full min-w-48 rounded-lg border border-transparent bg-transparent px-2 text-sm outline-none hover:border-input focus:border-input focus:bg-background",
                              !r.full_name && "placeholder:text-rose-500",
                            )}
                          />
                          {(bad || warn || r.status !== "new" || r.warnings.length > 0) && (
                            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1">
                              {bad && <Badge tone="red">Fix</Badge>}
                              {warn && <Badge tone="amber">Repeat</Badge>}
                              {r.status === "existing" && <Badge tone="indigo">Known</Badge>}
                              {r.status === "already-enrolled" && (
                                <Badge tone="slate">Enrolled</Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {r.note}
                                {r.warnings.length ? ` · ${r.warnings.join(" · ")}` : ""}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="p-1.5 align-top">
                          <select
                            value={r.grade_level ?? ""}
                            onChange={(e) =>
                              editRow(r.key, {
                                grade_level: e.target.value ? parseInt(e.target.value, 10) : null,
                              })
                            }
                            aria-label={`Grade for ${r.full_name ?? `row ${r.line}`}`}
                            className="h-9 w-full rounded-lg border border-transparent bg-transparent px-2 text-sm outline-none hover:border-input focus:border-input focus:bg-background"
                          >
                            <option value="">—</option>
                            {GRADE_LEVELS.map((g) => (
                              <option key={g} value={g}>
                                {gradeLevelLabel(g)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-1.5 align-top">
                          <input
                            value={r.section ?? ""}
                            onChange={(e) => editRow(r.key, { section: e.target.value })}
                            aria-label={`Section for ${r.full_name ?? `row ${r.line}`}`}
                            placeholder="—"
                            className="h-9 w-28 rounded-lg border border-transparent bg-transparent px-2 text-sm outline-none hover:border-input focus:border-input focus:bg-background"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStep("paste")}
                className="flex h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" /> Edit pasted list
              </button>
              <div className="flex items-center gap-3">
                {rows.length - included.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {rows.length - included.length} row
                    {rows.length - included.length !== 1 ? "s" : ""} won&apos;t be added
                  </p>
                )}
                <button
                  type="button"
                  onClick={commit}
                  disabled={saving || included.length === 0}
                  className="flex h-11 items-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? (
                    "Adding…"
                  ) : (
                    <>
                      <Users className="h-4 w-4" />
                      {courseId
                        ? `Enroll ${included.length} student${included.length !== 1 ? "s" : ""}`
                        : `Add ${included.length} student${included.length !== 1 ? "s" : ""}`}
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {step === "done" && result && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="space-y-4"
          >
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-500" />
              <div>
                <p className="text-sm font-semibold">
                  {result.added + result.linked} student
                  {result.added + result.linked !== 1 ? "s" : ""}
                  {courseId ? " added" : " saved"}
                  {courseLabel ? ` to ${courseLabel}` : ""}.
                </p>
                <p className="text-xs text-muted-foreground">
                  {result.meeting_added != null && result.meeting_added > 0
                    ? `${result.meeting_added} also placed in the selected meeting.`
                    : courseId
                      ? "They can start working in the course right away."
                      : "Find them on the Students page."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Added", value: result.added, cls: "text-emerald-500" },
                { label: "Already known", value: result.linked, cls: "text-indigo-400" },
                { label: "Skipped", value: skipped, cls: "text-amber-400" },
                {
                  label: "Failed",
                  value: result.rows.filter((r) => r.status === "failed").length,
                  cls: "text-rose-500",
                },
              ].map((s, i) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.06 }}
                  className="rounded-2xl border border-border/70 bg-muted/40 p-4"
                >
                  <p className={cn("font-display text-3xl font-bold", s.cls)}>{s.value}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </p>
                </motion.div>
              ))}
            </div>

            {result.rows.some((r) => r.status === "failed") && (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-500">
                  Couldn&apos;t be added
                </p>
                <ul className="space-y-1">
                  {result.rows
                    .filter((r) => r.status === "failed")
                    .map((r) => (
                      <li key={r.index} className="flex justify-between gap-3 text-sm">
                        <span className="font-semibold">{r.full_name}</span>
                        <span className="text-muted-foreground">{r.error}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Done
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Standalone modal wrapper — used by the admin Students page. Mounts the
 * content only while open so every import starts from a clean slate.
 */
export function BulkAddStudentsModal({
  open,
  onClose,
  courseId,
  courseLabel,
  courseLocked,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  courseId?: string;
  courseLabel?: string;
  courseLocked?: boolean;
  onDone?: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Bulk add students" wide>
      {open && (
        <BulkAddStudentsContent
          onClose={onClose}
          {...(courseId ? { courseId } : {})}
          {...(courseLabel ? { courseLabel } : {})}
          {...(courseLocked ? { courseLocked } : {})}
          {...(onDone ? { onDone } : {})}
        />
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Review refresh (kept outside the component so edits re-flag rows)    */
/* ------------------------------------------------------------------ */

function refreshReview(
  rows: ReviewRow[],
  existing: Array<{ id: string; student_id?: string | null; email?: string | null }>,
  enrolled: Set<string>,
): ReviewRow[] {
  const checked = reviewClassList(
    rows.map((r) => validateClassListRow(r)),
    {
      existing,
      enrolledIds: enrolled,
    },
  );
  return checked.map((r, i) => {
    const prev = rows[i]!;
    // Manual exclusions stick — but a row the user just fixed turns back on.
    const wasFlagged = prev.status === "invalid" || prev.status === "duplicate";
    const flagged = r.status === "invalid" || r.status === "duplicate";
    const include = flagged ? false : wasFlagged ? true : prev.include && r.include;
    return { ...r, include };
  });
}
