import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudUpload, FileText, Plus, Sparkles, Trash2, X } from "lucide-react";
import { type Course, createQuizWithQuestions, formatFileSize } from "@/lib/lms";
import { extractTextFromFile, isWorksheetAcceptedFile } from "@/lib/extract-text";
import {
  aggregateSourceMaterial,
  buildSourceMaterial,
  type SourceFile,
} from "@/lib/classmate-source";
import { parseWorksheet } from "@/lib/worksheet-parser";
import { openWorksheetChat, onPasteToWorksheet } from "@/lib/worksheet-context";
import {
  DEFAULT_QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  WORKSHEET_QUESTION_TYPES,
  formatQuestionTypes,
  type WorksheetQuestionType,
} from "@/lib/worksheet-types";
import { Modal, useProfile } from "@/components/lms";
import { PolicyFields } from "@/components/courses/policy-fields";
import { getTeacherSettings } from "@/lib/settings";
import {
  EMPTY_POLICY,
  EMPTY_MANUAL_Q,
  COURSE_MATERIAL_MAX_BYTES,
  SOURCE_FILES_MAX_COUNT,
  SOURCE_FILES_MAX_TOTAL_BYTES,
  classmateBankSize,
  policyPayload,
  type QuizMode,
  type ManualQuestion,
} from "@/components/courses/constants";
import { cn } from "@/lib/utils";

interface CreateQuizModalProps {
  open: boolean;
  onClose: () => void;
  courses: Course[];
  /** Pre-select this course when the modal opens (course-scoped creation). */
  defaultCourseId?: string;
  onSaved: () => void;
}

export function CreateQuizModal({
  open,
  onClose,
  courses,
  defaultCourseId,
  onSaved,
}: CreateQuizModalProps) {
  const qc = useQueryClient();
  const profile = useProfile(["teacher", "admin"]);
  const [saving, setSaving] = useState(false);

  const getInitialPolicy = () => {
    if (!profile) return EMPTY_POLICY;
    const s = getTeacherSettings(profile.id);
    const policyMap: Record<string, "highest_score" | "latest_attempt" | "average_score"> = {
      highest_score: "highest_score",
      latest_score: "latest_attempt",
      average_score: "average_score",
    };
    return {
      allow_retake: false,
      unlimited: false,
      max_attempts: "1",
      retake_score_policy: policyMap[s.defaultScorePolicy] ?? "highest_score",
    };
  };

  const [quizForm, setQuizForm] = useState({
    ...EMPTY_POLICY,
    course_id: "",
    title: "",
    duration_minutes: "15",
    question_count: "0",
    questions: "",
    opens_at: "",
    closes_at: "",
  });

  useEffect(() => {
    if (open && profile) {
      const policy = getInitialPolicy();
      setQuizForm((f) => ({
        ...f,
        ...policy,
      }));
    }
  }, [open, profile?.id]);
  const [quizMode, setQuizMode] = useState<QuizMode>("classmate");
  const [manualQuestions, setManualQuestions] = useState<ManualQuestion[]>([]);
  const [quizFileDrag, setQuizFileDrag] = useState(false);
  const [quizFiles, setQuizFiles] = useState<SourceFile[]>([]);
  const [questionTypes, setQuestionTypes] =
    useState<WorksheetQuestionType[]>(DEFAULT_QUESTION_TYPES);

  // Listen for "Send to worksheet" from ClassMate chat
  useEffect(() => {
    return onPasteToWorksheet((text) => {
      setQuizForm((f) => ({ ...f, questions: text }));
      setQuizFiles([]);
      toast.success("Worksheet content received from ClassMate");
    });
  }, []);

  // When opened from inside a course, scope the new worksheet to that course.
  useEffect(() => {
    if (!open || !defaultCourseId) return;
    setQuizForm((f) => ({ ...f, course_id: defaultCourseId }));
  }, [open, defaultCourseId]);

  const handleClose = () => {
    onClose();
    setQuizMode("classmate");
    setManualQuestions([]);
    setQuizFiles([]);
    setQuestionTypes(DEFAULT_QUESTION_TYPES);
  };

  /** Sync the aggregated source material into the questions textarea. */
  const applySourceFiles = (files: SourceFile[]) => {
    setQuizFiles(files);
    setQuizForm((f) => ({ ...f, questions: aggregateSourceMaterial(files) }));
  };

  const removeSourceFile = (index: number) => {
    applySourceFiles(quizFiles.filter((_, i) => i !== index));
  };

  const handleFilesLoad = async (incoming: File[]) => {
    if (incoming.length === 0) return;

    const accepted = incoming.filter(isWorksheetAcceptedFile);
    if (accepted.length < incoming.length) {
      toast.error("Only .txt, .md, .pdf, and .docx files are supported.");
    }
    const sized = accepted.filter((f) => f.size <= COURSE_MATERIAL_MAX_BYTES);
    if (sized.length < accepted.length) {
      toast.error(`Some files were skipped — each file must be 10MB or smaller.`);
    }
    if (sized.length === 0) return;

    const room = SOURCE_FILES_MAX_COUNT - quizFiles.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${SOURCE_FILES_MAX_COUNT} source files.`);
      return;
    }
    const batch = sized.slice(0, room);
    if (batch.length < sized.length) {
      toast.error(`Only ${SOURCE_FILES_MAX_COUNT} source files are allowed; extras were skipped.`);
    }

    const existingBytes = quizFiles.reduce((sum, f) => sum + f.size, 0);
    const batchBytes = batch.reduce((sum, f) => sum + f.size, 0);
    if (existingBytes + batchBytes > SOURCE_FILES_MAX_TOTAL_BYTES) {
      toast.error(
        `Total source material must stay under ${formatFileSize(SOURCE_FILES_MAX_TOTAL_BYTES)}.`,
      );
      return;
    }

    const loaded: SourceFile[] = [];
    // Extract in parallel; each file is independent so one failure must not
    // block the others.
    const results = await Promise.allSettled(
      batch.map(async (file) => ({
        name: file.name,
        size: file.size,
        text: await extractTextFromFile(file),
      })),
    );
    results.forEach((result, i) => {
      if (result.status === "fulfilled" && result.value.text.trim()) {
        loaded.push(result.value);
      } else if (result.status === "fulfilled") {
        // Extraction "succeeded" but produced no text (e.g. a scanned/image
        // PDF). Treat it as a failure so it is never silently dropped from the
        // model's file count.
        toast.error(
          `No readable text found in "${batch[i]!.name}" — try another file or paste the content.`,
        );
      } else {
        toast.error(`Could not read "${batch[i]!.name}" — try another file or paste the content.`);
      }
    });
    if (loaded.length === 0) return;

    const next = [...quizFiles, ...loaded];
    applySourceFiles(next);

    const combined = aggregateSourceMaterial(next);
    const { questions, dropped } = parseWorksheet(combined);
    if (questions.length > 0) {
      toast.success(
        `Loaded ${questions.length} question(s) from ${next.length} file${next.length > 1 ? "s" : ""}${dropped ? ` (${dropped} skipped)` : ""}`,
      );
      return;
    }

    const course = courses.find((c) => c.id === quizForm.course_id);
    if (course && quizForm.title.trim()) {
      const perStudent = Math.max(0, parseInt(quizForm.question_count) || 0);
      // Budget across ALL files so none is dropped, and hand the model the exact
      // file names + selected question types.
      const built = buildSourceMaterial(next);
      openWorksheetChat({
        course: `${course.code} — ${course.title}`,
        title: quizForm.title.trim(),
        sourceMaterial: built.text,
        sourceFileNames: built.files.map((f) => f.name),
        questionTypes,
        autoMessage: `Generate ${classmateBankSize(perStudent)} parser-ready questions of these types only: ${formatQuestionTypes(questionTypes)} — based on the uploaded material (${next.length} source file${next.length > 1 ? "s" : ""}) for "${quizForm.title.trim()}". Follow the parser format and include an Answer Key.`,
      });
      toast.success("Files loaded — ClassMate is generating questions now.");
    } else {
      toast.success(
        "Files loaded. Select a course and title, then click 'Generate with ClassMate'.",
      );
    }
  };

  const saveQuiz = async () => {
    if (!quizForm.course_id || !quizForm.title) {
      toast.error("Course and title are required.");
      return;
    }

    // Question-bank size: 0 = serve every question; N>0 = serve a random,
    // per-attempt non-overlapping subset of N. Clamp to the parsed bank size so
    // a worksheet can't ask for more items than it actually has.
    const requested = Math.max(0, parseInt(quizForm.question_count) || 0);

    let questions: Array<{ question: string; options: string[]; correct_answer: string }>;

    if (quizMode === "manual") {
      const valid = manualQuestions.filter((q) => q.question.trim() && q.correct_answer.trim());
      if (valid.length === 0) {
        toast.error("Add at least one question with a question text and correct answer.");
        return;
      }
      const invalidMc = valid.find(
        (q) => q.kind === "mc" && q.options.filter(Boolean).length !== 4,
      );
      if (invalidMc) {
        toast.error("Each multiple-choice question must have exactly four options (A–D).");
        return;
      }
      questions = valid.map((q) => ({
        question: q.question.trim(),
        options: q.kind === "mc" ? q.options.filter(Boolean) : [],
        correct_answer: q.correct_answer.trim(),
      }));
    } else {
      const parsed = parseWorksheet(quizForm.questions);
      if (!parsed.questions.length) {
        toast.error(
          "No valid questions found — paste a worksheet (with its Answer Key), upload a file, or use 'Generate with ClassMate'.",
        );
        return;
      }
      if (parsed.dropped > 0) {
        toast.warning(
          `${parsed.dropped} item${parsed.dropped > 1 ? "s were" : " was"} skipped — check their numbering against the Answer Key.`,
        );
      }
      if (parsed.questions.some((q) => q.kind === "mc" && q.options.length !== 4)) {
        toast.error("Each multiple-choice question must have exactly four options (A–D).");
        return;
      }
      if (requested > 0 && parsed.questions.length > requested) {
        toast.warning(
          `ClassMate generated ${parsed.questions.length} questions but you requested ${requested}. All ${parsed.questions.length} will be saved; each student still only sees ${requested} at random.`,
        );
      }
      questions = parsed.questions;
    }

    // Never store a bank size larger than the question pool — otherwise every
    // attempt would show the same full set.
    const questionCount = requested > 0 && requested < questions.length ? requested : 0;

    setSaving(true);
    try {
      await createQuizWithQuestions(
        {
          course_id: quizForm.course_id,
          title: quizForm.title,
          duration_minutes: parseInt(quizForm.duration_minutes) || 15,
          question_count: questionCount,
          opens_at: quizForm.opens_at ? new Date(quizForm.opens_at).toISOString() : null,
          closes_at: quizForm.closes_at ? new Date(quizForm.closes_at).toISOString() : null,
          ...policyPayload(quizForm),
        },
        questions,
      );
      toast.success(`Worksheet created with ${questions.length} questions.`);
      onSaved();
      setQuizForm({
        ...EMPTY_POLICY,
        course_id: "",
        title: "",
        duration_minutes: "15",
        question_count: "0",
        questions: "",
        opens_at: "",
        closes_at: "",
      });
      setManualQuestions([]);
      setQuizMode("classmate");
      setQuizFiles([]);
      setQuestionTypes(DEFAULT_QUESTION_TYPES);
      onClose();
    } catch {
      toast.error("Could not create worksheet.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Create worksheet" wide>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <select
            value={quizForm.course_id}
            onChange={(e) => setQuizForm((f) => ({ ...f, course_id: e.target.value }))}
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring sm:col-span-2"
          >
            <option value="">Select course *</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
          <input
            value={quizForm.duration_minutes}
            onChange={(e) => setQuizForm((f) => ({ ...f, duration_minutes: e.target.value }))}
            placeholder="Minutes"
            inputMode="numeric"
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <input
          value={quizForm.title}
          onChange={(e) => setQuizForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="Worksheet title *"
          className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
              Questions per student
            </span>
            <input
              value={quizForm.question_count}
              onChange={(e) => setQuizForm((f) => ({ ...f, question_count: e.target.value }))}
              placeholder="0"
              inputMode="numeric"
              className="h-9 w-20 rounded-lg border border-input bg-background px-3 text-sm text-center outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <span className="text-[11px] text-muted-foreground">
            0 = all questions · e.g. 10 = a different random 10 per student/attempt
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            <span>Opens at (Availability date/time)</span>
            <input
              type="datetime-local"
              value={quizForm.opens_at}
              onChange={(e) => setQuizForm((f) => ({ ...f, opens_at: e.target.value }))}
              aria-label="Worksheet opens at"
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            <span>Closes at (Deadline / Hard lock)</span>
            <input
              type="datetime-local"
              value={quizForm.closes_at}
              onChange={(e) => setQuizForm((f) => ({ ...f, closes_at: e.target.value }))}
              aria-label="Worksheet closes at"
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>
        <PolicyFields
          value={quizForm}
          onChange={(patch) => setQuizForm((f) => ({ ...f, ...patch }))}
        />

        <div className="flex gap-2 rounded-xl border border-border bg-muted/30 p-1">
          <button
            type="button"
            onClick={() => setQuizMode("classmate")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition",
              quizMode === "classmate"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Sparkles className="h-3.5 w-3.5" /> Generate with ClassMate
          </button>
          <button
            type="button"
            onClick={() => setQuizMode("manual")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition",
              quizMode === "manual"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <FileText className="h-3.5 w-3.5" /> Manual Entry
          </button>
        </div>

        {quizMode === "classmate" && (
          <>
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                Question types ClassMate should generate
              </p>
              <div className="flex flex-wrap gap-2">
                {WORKSHEET_QUESTION_TYPES.map((t) => {
                  const active = questionTypes.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setQuestionTypes((prev) =>
                          prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                        )
                      }
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {QUESTION_TYPE_LABELS[t]}
                    </button>
                  );
                })}
              </div>
              {questionTypes.length === 0 ? (
                <p className="mt-2 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  Select at least one question type before generating.
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  ClassMate will generate only these types: {formatQuestionTypes(questionTypes)}.
                </p>
              )}
            </div>
            {quizFiles.length > 0 && (
              <div className="grid gap-1.5">
                {quizFiles.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">{f.name}</span>
                    <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                      {formatFileSize(f.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => removeSourceFile(i)}
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setQuizFileDrag(true);
              }}
              onDragLeave={() => setQuizFileDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setQuizFileDrag(false);
                void handleFilesLoad(Array.from(e.dataTransfer.files ?? []));
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-3 py-5 text-center transition",
                quizFileDrag
                  ? "border-primary bg-primary/10 ring-2 ring-primary/40"
                  : "border-border hover:border-primary/50 hover:bg-muted/60",
              )}
            >
              <CloudUpload
                className={cn("h-5 w-5", quizFileDrag ? "text-primary" : "text-muted-foreground")}
              />
              <p className="text-xs font-semibold">
                {quizFiles.length > 0
                  ? "Add more source files, or drop them here"
                  : "Drag & drop files here, or click to browse"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Supports .txt, .md, .pdf, .docx · up to {SOURCE_FILES_MAX_COUNT} files (10MB each,
                30MB total) — optional, for source material context.
              </p>
              <input
                type="file"
                accept=".txt,.md,.pdf,.docx"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleFilesLoad(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">
              Or paste questions &amp; answer key
            </label>
            <textarea
              value={quizForm.questions}
              onChange={(e) => setQuizForm((f) => ({ ...f, questions: e.target.value }))}
              rows={9}
              placeholder={
                "Paste a ClassMate worksheet (Sections I–IV + Answer Key):\n\nSection I: Multiple Choice\n1. What is 7 × 8?\nA. 54\nB. 56\nC. 63\nD. 48\n\nSection II: Fill in the Blank\n2. Water boils at ______ °C.\n…\n\nAnswer Key:\n1. B - 7 groups of 8 make 56\n2. 100 (Acceptable: one hundred)"
              }
              className="rounded-xl border border-input bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              disabled={questionTypes.length === 0}
              onClick={() => {
                const course = courses.find((c) => c.id === quizForm.course_id);
                if (!course) {
                  toast.error(
                    "Select a course first — ClassMate will use it as the worksheet context.",
                  );
                  return;
                }
                if (!quizForm.title.trim()) {
                  toast.error("Enter a worksheet title first.");
                  return;
                }
                if (questionTypes.length === 0) {
                  toast.error("Select at least one question type.");
                  return;
                }
                openWorksheetChat({
                  course: `${course.code} — ${course.title}`,
                  title: quizForm.title.trim(),
                  questionTypes,
                  ...(quizForm.questions ? { sourceMaterial: quizForm.questions } : {}),
                });
                toast.success("ClassMate is ready — tell it the topic and item count.");
              }}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 text-sm font-semibold text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Generate with ClassMate
            </button>
          </>
        )}

        {quizMode === "manual" && (
          <>
            {manualQuestions.length === 0 && (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
                <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm font-semibold">No questions yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click "Add Question" below to start building your worksheet.
                </p>
              </div>
            )}
            <div className="space-y-3 pr-1">
              {manualQuestions.map((q, qi) => (
                <div key={qi} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-muted-foreground">Q{qi + 1}</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={q.kind}
                        onChange={(e) => {
                          const kind = e.target.value as ManualQuestion["kind"];
                          setManualQuestions((prev) =>
                            prev.map((pq, i) =>
                              i === qi
                                ? {
                                    ...pq,
                                    kind,
                                    options:
                                      kind === "mc"
                                        ? pq.options.length >= 4
                                          ? pq.options
                                          : ["", "", "", ""]
                                        : [],
                                  }
                                : pq,
                            ),
                          );
                        }}
                        className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                      >
                        <option value="mc">Multiple Choice</option>
                        <option value="fill">Fill in the Blank</option>
                        <option value="essay">Essay / Short Answer</option>
                        <option value="matching">Matching</option>
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          setManualQuestions((prev) => prev.filter((_, i) => i !== qi))
                        }
                        className="rounded-lg p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <input
                    value={q.question}
                    onChange={(e) =>
                      setManualQuestions((prev) =>
                        prev.map((pq, i) => (i === qi ? { ...pq, question: e.target.value } : pq)),
                      )
                    }
                    placeholder={
                      q.kind === "fill"
                        ? "Sentence with ______ blank"
                        : q.kind === "essay"
                          ? "Essay prompt or question"
                          : "Question text"
                    }
                    className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                  />
                  {q.kind === "mc" && (
                    <div className="grid grid-cols-2 gap-1.5">
                      {["A", "B", "C", "D"].map((letter, oi) => (
                        <div key={letter} className="flex items-center gap-1">
                          <span className="text-[11px] font-bold text-muted-foreground w-4">
                            {letter}.
                          </span>
                          <input
                            value={q.options[oi] ?? ""}
                            onChange={(e) =>
                              setManualQuestions((prev) => {
                                const opts = [...(prev[qi]?.options ?? ["", "", "", ""])];
                                opts[oi] = e.target.value;
                                return prev.map((pq, i) =>
                                  i === qi ? { ...pq, options: opts } : pq,
                                );
                              })
                            }
                            placeholder={`Option ${letter}`}
                            className="h-8 flex-1 rounded-lg border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {q.kind === "mc" && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        Correct:
                      </span>
                      <select
                        value={q.correct_answer}
                        onChange={(e) =>
                          setManualQuestions((prev) =>
                            prev.map((pq, i) =>
                              i === qi ? { ...pq, correct_answer: e.target.value } : pq,
                            ),
                          )
                        }
                        className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                      >
                        <option value="">Select answer</option>
                        {q.options.filter(Boolean).map((opt, oi) => (
                          <option key={oi} value={opt}>
                            {String.fromCharCode(65 + oi)}. {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {q.kind === "fill" && (
                    <input
                      value={q.correct_answer}
                      onChange={(e) =>
                        setManualQuestions((prev) =>
                          prev.map((pq, i) =>
                            i === qi ? { ...pq, correct_answer: e.target.value } : pq,
                          ),
                        )
                      }
                      placeholder="Correct answer (e.g. 100)"
                      className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                    />
                  )}
                  {q.kind === "essay" && (
                    <textarea
                      value={q.correct_answer}
                      onChange={(e) =>
                        setManualQuestions((prev) =>
                          prev.map((pq, i) =>
                            i === qi ? { ...pq, correct_answer: e.target.value } : pq,
                          ),
                        )
                      }
                      placeholder="Rubric / key points (e.g. Must mention: photosynthesis, sunlight, chlorophyll)"
                      rows={2}
                      className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                    />
                  )}
                  {q.kind === "matching" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="mb-1 text-[10px] font-semibold text-muted-foreground">
                          Column A (premises)
                        </p>
                        <textarea
                          value={q.question}
                          onChange={(e) =>
                            setManualQuestions((prev) =>
                              prev.map((pq, i) =>
                                i === qi ? { ...pq, question: e.target.value } : pq,
                              ),
                            )
                          }
                          placeholder={"1. Premise A\n2. Premise B"}
                          rows={3}
                          className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] font-semibold text-muted-foreground">
                          Column B (options)
                        </p>
                        <textarea
                          value={q.options.join("\n")}
                          onChange={(e) =>
                            setManualQuestions((prev) =>
                              prev.map((pq, i) =>
                                i === qi ? { ...pq, options: e.target.value.split("\n") } : pq,
                              ),
                            )
                          }
                          placeholder={"A. Option 1\nB. Option 2\nC. Option 3\nD. Option 4"}
                          rows={3}
                          className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    </div>
                  )}
                  {q.kind === "matching" && (
                    <input
                      value={q.correct_answer}
                      onChange={(e) =>
                        setManualQuestions((prev) =>
                          prev.map((pq, i) =>
                            i === qi ? { ...pq, correct_answer: e.target.value } : pq,
                          ),
                        )
                      }
                      placeholder="Correct pairs (e.g. 1-A, 2-C, 3-B)"
                      className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                    />
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setManualQuestions((prev) => [...prev, { ...EMPTY_MANUAL_Q }])}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-4 w-4" /> Add Question
            </button>
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={saveQuiz}
          disabled={saving}
          className="h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create worksheet"}
        </button>
      </div>
    </Modal>
  );
}
