import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { type Course, createCourse, updateCourse } from "@/lib/lms";
import { Modal, Badge, courseStyle } from "@/components/lms";
import {
  COURSE_LEVELS,
  educationLevelOf,
  collegeYearOf,
  courseLevelLabel,
} from "@/lib/course-levels";
import { CED_PROGRAMS, CED_DEPARTMENT_LABELS } from "@/lib/ced-programs";
import {
  EMPTY_COURSE,
  COLORS,
  DAYS,
  WIZARD_STEPS,
  type WizardStep,
} from "@/components/courses/constants";
import { cn } from "@/lib/utils";

interface CourseWizardModalProps {
  open: boolean;
  onClose: () => void;
  editing: Course | null;
  teachers: Array<{ id: string; full_name: string }>;
  isAdmin: boolean;
  currentUserId?: string;
  onSaved: () => void;
}

type WizardErrors = Partial<
  Record<"title" | "code" | "level" | "strand" | "program" | "schedule", string | undefined>
>;

export function CourseWizardModal({
  open,
  onClose,
  editing,
  teachers,
  isAdmin,
  currentUserId,
  onSaved,
}: CourseWizardModalProps) {
  const qc = useQueryClient();
  const [courseForm, setCourseForm] = useState(EMPTY_COURSE);
  const [wizardStep, setWizardStep] = useState<WizardStep>("basic");
  const [errors, setErrors] = useState<WizardErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (editing) {
      setCourseForm({
        // Trim on load so legacy trailing spaces never round-trip back to the DB.
        title: editing.title.trim(),
        code: editing.code.trim(),
        grade_level: String(editing.grade_level),
        teacher_id: editing.teacher_id ?? "",
        color: editing.color,
        days: editing.days_of_week ?? [],
        start_time: editing.start_time ? editing.start_time.slice(0, 5) : "",
        end_time: editing.end_time ? editing.end_time.slice(0, 5) : "",
        grace: String(editing.late_threshold_minutes ?? 10),
        strand: editing.strand ?? "",
        program: editing.program ?? "",
      });
    } else {
      setCourseForm({
        ...EMPTY_COURSE,
        // Pre-select the creating teacher as the course lead when not an admin
        teacher_id: !isAdmin && currentUserId ? currentUserId : EMPTY_COURSE.teacher_id,
      });
    }
    setWizardStep("basic");
  }, [open, editing, isAdmin, currentUserId]);

  /** Validate every step at once and jump to the first step that needs a fix. */
  const validateForm = (): WizardErrors | null => {
    const errs: WizardErrors = {};
    const lvl = parseInt(courseForm.grade_level);
    if (!courseForm.title.trim()) errs.title = "Enter a course title.";
    if (!courseForm.code.trim()) errs.code = "Enter a course code.";
    if (Number.isNaN(lvl) || lvl < 7 || lvl > 16)
      errs.level = "Level must be Grade 7 – College 4th Year (7–16).";
    if ((lvl === 11 || lvl === 12) && !courseForm.strand)
      errs.strand = "Please select a strand for SHS (G11–G12).";
    if (lvl >= 13 && lvl <= 16 && !courseForm.program?.trim())
      errs.program = "Please enter a program for College (e.g. BSIT, BSED).";
    if (courseForm.days.length > 0 && (!courseForm.start_time || !courseForm.end_time))
      errs.schedule = "Set both a start and end time for the scheduled days (or clear the days).";
    return Object.keys(errs).length > 0 ? errs : null;
  };

  const stepOfError = (errs: WizardErrors): WizardStep => {
    if (errs.title || errs.code || errs.level) return "basic";
    if (errs.strand || errs.program) return "assignment";
    return "schedule";
  };

  const saveCourse = async () => {
    const errs = validateForm();
    if (errs) {
      setErrors(errs);
      setWizardStep(stepOfError(errs));
      toast.error(Object.values(errs)[0]!);
      return;
    }
    setErrors({});
    const lvl = parseInt(courseForm.grade_level);
    setSaving(true);
    try {
      const education_level = educationLevelOf(lvl);
      const college_year = collegeYearOf(lvl);
      // The lead is only sent when it actually changed. An empty selection
      // while editing keeps the existing lead (it never silently clears it),
      // and an unchanged lead is left out of the patch entirely so legacy
      // leads outside the teacher list can't fail validation on other edits.
      const nextLeadId = courseForm.teacher_id;
      const leadChanged = nextLeadId !== (editing?.teacher_id ?? "");
      const leadPatch = editing
        ? leadChanged && nextLeadId
          ? { teacher_id: nextLeadId }
          : {}
        : { teacher_id: nextLeadId || null };
      const payload: Partial<Course> = {
        title: courseForm.title.trim(),
        code: courseForm.code.trim(),
        grade_level: lvl,
        education_level,
        college_year,
        strand: lvl >= 11 && lvl <= 12 ? courseForm.strand || null : null,
        program: lvl >= 13 ? courseForm.program?.trim() || null : null,
        ...leadPatch,
        color: courseForm.color,
        days_of_week: courseForm.days.length ? courseForm.days : null,
        start_time: courseForm.days.length ? courseForm.start_time : null,
        end_time: courseForm.days.length ? courseForm.end_time : null,
        late_threshold_minutes: Math.min(60, Math.max(0, parseInt(courseForm.grace) || 10)),
      };
      if (editing) {
        await updateCourse(editing.id, payload);
        toast.success("Course updated.");
      } else {
        await createCourse(payload);
        toast.success("Course created.");
      }
      onSaved();
      onClose();
    } catch {
      toast.error(editing ? "Could not update course." : "Could not create course.");
    } finally {
      setSaving(false);
    }
  };

  /* The teachers list only holds teacher-role profiles, but a course lead may
     be a legacy/admin lead (listCourses resolves teacher_name from teachers AND
     admins). Keep the real lead visible and selectable even when the list does
     not contain them — otherwise the select falls back to "Assign teacher…"
     and a save can look like it dropped the lead. */
  const currentLeadId = editing?.teacher_id ?? "";
  const leadInList = teachers.some((t) => t.id === currentLeadId);
  const currentLeadName =
    editing?.teacher_name ??
    teachers.find((t) => t.id === currentLeadId)?.full_name ??
    "Current course lead";
  const currentStrand = courseForm.strand ?? "";
  const currentProgram = courseForm.program ?? "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.code}` : "New course"}
      wide
    >
      <div className="mb-5 flex items-center gap-1.5">
        {WIZARD_STEPS.map((s, idx) => {
          const isActive = wizardStep === s.id;
          const isPast = WIZARD_STEPS.findIndex((x) => x.id === wizardStep) > idx;
          return (
            <div key={s.id} className="flex flex-1 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setWizardStep(s.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : isPast
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                    isActive
                      ? "bg-white text-primary"
                      : isPast
                        ? "bg-emerald-500 text-white"
                        : "bg-muted-foreground/20",
                  )}
                >
                  {idx + 1}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
                <span className="sm:hidden">{s.label.slice(0, 3)}</span>
              </button>
              {idx < WIZARD_STEPS.length - 1 && (
                <span
                  className={cn(
                    "hidden h-px flex-1 sm:block",
                    isPast ? "bg-emerald-500/40" : "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
        <div className={cn("h-2.5 w-2.5 rounded-full", courseStyle(courseForm.color).chip)} />
        <span className="truncate text-sm font-semibold">
          {courseForm.title.trim() || "Untitled course"}
        </span>
        <Badge tone="indigo">
          {courseLevelLabel({
            grade_level: parseInt(courseForm.grade_level) || 10,
            program: courseForm.program,
          })}
        </Badge>
        {courseForm.code && (
          <span className="text-xs font-medium text-muted-foreground">{courseForm.code}</span>
        )}
        {courseForm.program && parseInt(courseForm.grade_level) >= 13 && (
          <span className="text-xs text-muted-foreground">· {courseForm.program}</span>
        )}
        {courseForm.strand &&
          (courseForm.grade_level === "11" || courseForm.grade_level === "12") && (
            <span className="text-xs text-muted-foreground">· {courseForm.strand}</span>
          )}
      </div>

      {wizardStep === "basic" && (
        <div className="grid gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Course title *
            </span>
            <input
              value={courseForm.title}
              onChange={(e) => {
                setCourseForm((f) => ({ ...f, title: e.target.value }));
                if (errors.title) setErrors((x) => ({ ...x, title: undefined }));
              }}
              placeholder="e.g. Mathematics 7"
              aria-invalid={errors.title ? true : undefined}
              className={cn(
                "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring",
                errors.title && "border-rose-400 focus:ring-rose-400/40",
              )}
            />
            {errors.title && (
              <span className="mt-1 block text-[11px] font-medium text-rose-600 dark:text-rose-400">
                {errors.title}
              </span>
            )}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">Code *</span>
              <input
                value={courseForm.code}
                onChange={(e) => {
                  setCourseForm((f) => ({ ...f, code: e.target.value }));
                  if (errors.code) setErrors((x) => ({ ...x, code: undefined }));
                }}
                placeholder="e.g. MATH7"
                aria-invalid={errors.code ? true : undefined}
                className={cn(
                  "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring",
                  errors.code && "border-rose-400 focus:ring-rose-400/40",
                )}
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {errors.code ?? "Short code shown on course cards, e.g. ICT1."}
              </span>
            </label>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                Level *
              </label>
              <select
                value={courseForm.grade_level}
                onChange={(e) => {
                  setCourseForm({ ...courseForm, grade_level: e.target.value });
                  if (errors.level || errors.strand || errors.program)
                    setErrors((x) => ({
                      ...x,
                      level: undefined,
                      strand: undefined,
                      program: undefined,
                    }));
                }}
                className={cn(
                  "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring",
                  errors.level && "border-rose-400 focus:ring-rose-400/40",
                )}
                aria-label="Course level"
              >
                {COURSE_LEVELS.map((lv) => (
                  <option key={lv.value} value={String(lv.value)}>
                    {lv.label}
                  </option>
                ))}
              </select>
              <p
                className={cn(
                  "mt-1 text-[11px]",
                  errors.level
                    ? "font-medium text-rose-600 dark:text-rose-400"
                    : "text-muted-foreground",
                )}
              >
                {errors.level ??
                  (() => {
                    const n = parseInt(courseForm.grade_level) || 10;
                    const edu = educationLevelOf(n);
                    const yr = collegeYearOf(n);
                    return edu === "college"
                      ? `College Year ${yr} · college`
                      : edu === "shs"
                        ? "Senior High (SHS)"
                        : "Junior High (JHS)";
                  })()}
              </p>
            </div>
          </div>
        </div>
      )}

      {wizardStep === "assignment" && (
        <div className="grid gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Course lead (teacher)
            </span>
            <select
              aria-label="Course lead"
              value={courseForm.teacher_id}
              onChange={(e) => setCourseForm((f) => ({ ...f, teacher_id: e.target.value }))}
              disabled={!isAdmin}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
            >
              {!isAdmin && (
                <option value={courseForm.teacher_id}>
                  {teachers.find((t) => t.id === courseForm.teacher_id)?.full_name ??
                    editing?.teacher_name ??
                    "You"}
                </option>
              )}
              {isAdmin && (
                <option value="">
                  {editing?.teacher_id ? "Keep current lead" : "Assign teacher…"}
                </option>
              )}
              {isAdmin && currentLeadId && !leadInList && (
                <option value={currentLeadId}>{currentLeadName}</option>
              )}
              {isAdmin &&
                teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
            </select>
            {!isAdmin && (
              <span className="mt-1 block text-xs text-muted-foreground">
                You will be assigned as the course lead.
              </span>
            )}
            {isAdmin && editing?.teacher_id && (
              <span className="mt-1 block text-[11px] text-muted-foreground">
                Saving without changing this keeps {currentLeadName} as the course lead.
              </span>
            )}
          </label>
          {(courseForm.grade_level === "11" || courseForm.grade_level === "12") && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                Strand (SHS) *
              </span>
              <select
                value={courseForm.strand ?? ""}
                onChange={(e) => {
                  setCourseForm({ ...courseForm, strand: e.target.value });
                  if (errors.strand) setErrors((x) => ({ ...x, strand: undefined }));
                }}
                aria-invalid={errors.strand ? true : undefined}
                className={cn(
                  "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring",
                  errors.strand && "border-rose-400 focus:ring-rose-400/40",
                )}
              >
                <option value="">Select strand</option>
                <option value="STEM">STEM</option>
                <option value="ABM">ABM</option>
                <option value="HUMSS">HUMSS</option>
                <option value="GAS">GAS</option>
                <option value="TVL">TVL</option>
                {/* Keep a stored strand visible even if it's outside the preset list. */}
                {currentStrand &&
                  !["STEM", "ABM", "HUMSS", "GAS", "TVL"].includes(currentStrand) && (
                    <option value={currentStrand}>{currentStrand}</option>
                  )}
              </select>
              {errors.strand && (
                <span className="mt-1 block text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {errors.strand}
                </span>
              )}
            </label>
          )}
          {(courseForm.grade_level === "13" ||
            courseForm.grade_level === "14" ||
            courseForm.grade_level === "15" ||
            courseForm.grade_level === "16") && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                Program (College) *
              </span>
              <select
                value={courseForm.program ?? ""}
                onChange={(e) => {
                  setCourseForm({ ...courseForm, program: e.target.value });
                  if (errors.program) setErrors((x) => ({ ...x, program: undefined }));
                }}
                aria-invalid={errors.program ? true : undefined}
                className={cn(
                  "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring",
                  errors.program && "border-rose-400 focus:ring-rose-400/40",
                )}
              >
                <option value="">Select program</option>
                {/* Keep a stored program visible even if it's not a CED program
                    (e.g. BSIT) — otherwise the field renders blank on edit. */}
                {currentProgram && !CED_PROGRAMS.some((p) => p.name === currentProgram) && (
                  <option value={currentProgram}>{currentProgram}</option>
                )}
                {(["SME", "PRE", "PE", "TTE"] as const).map((dept) => {
                  const progs = CED_PROGRAMS.filter((p) => p.department === dept);
                  if (!progs.length) return null;
                  return (
                    <optgroup key={dept} label={CED_DEPARTMENT_LABELS[dept]}>
                      {progs.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              {errors.program && (
                <span className="mt-1 block text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {errors.program}
                </span>
              )}
            </label>
          )}
          <div>
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Accent color
            </span>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCourseForm((f) => ({ ...f, color: c }))}
                  className={cn(
                    "h-8 w-8 rounded-full",
                    courseStyle(c).chip,
                    courseForm.color === c ? "ring-2 ring-ring ring-offset-2" : "opacity-60",
                  )}
                  title={c}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Sets the course card bar, chips and header accents.
            </span>
          </div>
        </div>
      )}

      {wizardStep === "schedule" && (
        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-xs font-semibold text-muted-foreground">
            Class schedule (optional) — drives on-time/late taps
          </legend>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days of week">
            {DAYS.map((d) => {
              const active = courseForm.days.includes(d.code);
              return (
                <button
                  key={d.code}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setCourseForm((f) => ({
                      ...f,
                      days: active ? f.days.filter((x) => x !== d.code) : [...f.days, d.code],
                    }));
                    if (errors.schedule) setErrors((x) => ({ ...x, schedule: undefined }));
                  }}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          {courseForm.days.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                Start time
                <input
                  type="time"
                  aria-label="Class start time"
                  value={courseForm.start_time}
                  onChange={(e) => {
                    setCourseForm((f) => ({ ...f, start_time: e.target.value }));
                    if (errors.schedule) setErrors((x) => ({ ...x, schedule: undefined }));
                  }}
                  className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                End time
                <input
                  type="time"
                  aria-label="Class end time"
                  value={courseForm.end_time}
                  onChange={(e) => {
                    setCourseForm((f) => ({ ...f, end_time: e.target.value }));
                    if (errors.schedule) setErrors((x) => ({ ...x, schedule: undefined }));
                  }}
                  className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Late after (min)
                <input
                  inputMode="numeric"
                  aria-label="Late threshold in minutes"
                  value={courseForm.grace}
                  onChange={(e) => setCourseForm((f) => ({ ...f, grace: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                  Students arriving after this many minutes are marked late.
                </span>
              </label>
            </div>
          )}
          {errors.schedule && (
            <p className="mt-2 text-[11px] font-medium text-rose-600 dark:text-rose-400">
              {errors.schedule}
            </p>
          )}
        </fieldset>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {wizardStep !== "basic" ? (
          <button
            type="button"
            onClick={() => setWizardStep((s) => (s === "schedule" ? "assignment" : "basic"))}
            className="h-11 rounded-xl border border-border bg-card px-5 text-sm font-semibold hover:bg-muted"
          >
            Back
          </button>
        ) : (
          !editing && <div className="flex-1" />
        )}
        {wizardStep !== "schedule" ? (
          <button
            type="button"
            onClick={() => setWizardStep((s) => (s === "basic" ? "assignment" : "schedule"))}
            className="h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Next
          </button>
        ) : (
          !editing && (
            <button
              onClick={saveCourse}
              disabled={saving}
              className="h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Create course"}
            </button>
          )
        )}
        {editing && (
          <button
            onClick={saveCourse}
            disabled={saving}
            className="h-11 min-w-[8.5rem] flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        )}
      </div>
    </Modal>
  );
}
