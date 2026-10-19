import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { courseLevelLabel } from "@/lib/course-levels";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, FileUp, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { LoadingSkeleton, UserAvatar } from "@/components/ui-elements";
import { GradebookImportModal } from "@/components/courses/gradebook-import-modal";
import { ATTENDANCE_LIMIT_GRADES } from "@/components/courses/constants";
import {
  attendancePercent,
  enrollmentsForCourse,
  gradeRemarks,
  listAllAttendance,
  listCourses,
  listGradesForCourse,
  listStudents,
  termLabel,
  termOptions,
  transmute,
  upsertGrade,
  weightedInitial,
  type AttendanceLog,
  listQuizScoresForCourse,
  type QuizCourseScore,
  type GradeOverrideFlag,
} from "@/lib/lms";
import { buildXlsx, downloadBlob, type XlsxCell } from "@/lib/xlsx";
import { ClassRecord } from "@/components/courses/class-record";
import {
  OverrideFlagToggle,
  BulkColumnMenu,
  BulkFillModal,
  COLUMN_CONFIG,
  applyBulkColumnFill,
  clearColumnOverridesForRoster,
  extractOverrideFlagsPayload,
  formatOverridesSummary,
  type ColumnKey,
  type OverridesState,
} from "@/components/courses/grade-overrides";
import {
  TEACHER_NAV,
  AppShell,
  Badge,
  Card,
  EmptyState,
  MotionCard,
  useProfile,
} from "@/components/lms";
import { cn, sanitizeDecimal } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/admin/grades")({
  head: () => ({
    meta: [
      { title: "Gradebook | MIOW - Integrated Developmental School" },
      {
        name: "description",
        content: "Encode quarterly grades with automatic DepEd transmutation.",
      },
      { property: "og:title", content: "Gradebook | MIOW - Integrated Developmental School" },
      {
        property: "og:description",
        content: "Encode quarterly grades with automatic DepEd transmutation.",
      },
    ],
  }),
  component: GradebookPage,
});

interface CellState {
  ww: string;
  pt: string;
  ex: string;
}

export function GradebookPage() {
  const profile = useProfile(["admin", "teacher"]);
  const qc = useQueryClient();
  const { data: courses } = useQuery({
    queryKey: ["courses"],
    queryFn: listCourses,
    enabled: !!profile,
  });
  const { data: students } = useQuery({
    queryKey: ["students"],
    queryFn: listStudents,
    enabled: !!profile,
  });
  // Gate attendance feeds the Attendance (10%) component of the grading scheme.
  const { data: allLogs } = useQuery({
    queryKey: ["all-attendance"],
    queryFn: () => listAllAttendance(ATTENDANCE_LIMIT_GRADES),
    enabled: !!profile,
  });

  const [courseId, setCourseId] = useState("");
  const [quarter, setQuarter] = useState(1);
  const [section, setSection] = useState("all");
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [overrides, setOverrides] = useState<OverridesState>({});
  const [bulkFillColumn, setBulkFillColumn] = useState<ColumnKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [published, setPublished] = useState(false);
  const [gradeTab, setGradeTab] = useState<"grades" | "quizzes" | "class">("class");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [recordDirty, setRecordDirty] = useState(false);
  const leaveRecord = () => !recordDirty || window.confirm("Discard unsaved class-record changes?");

  const course = useMemo(() => (courses ?? []).find((c) => c.id === courseId), [courses, courseId]);

  const attByStudent = useMemo(() => {
    const grouped = new Map<string, AttendanceLog[]>();
    (allLogs ?? []).forEach((l) => {
      const arr = grouped.get(l.student_id) ?? [];
      arr.push(l);
      grouped.set(l.student_id, arr);
    });
    const out = new Map<string, number | null>();
    grouped.forEach((logs, id) => out.set(id, attendancePercent(logs)));
    return out;
  }, [allLogs]);
  const attOf = (sid: string): number | null => attByStudent.get(sid) ?? null;

  const { data: enrolledIds } = useQuery({
    queryKey: ["enrollments", courseId],
    queryFn: () => enrollmentsForCourse(courseId),
    enabled: !!courseId,
  });
  const { data: existing } = useQuery({
    queryKey: ["course-grades", courseId, quarter],
    queryFn: () => listGradesForCourse(courseId, quarter),
    enabled: !!courseId,
  });
  const { data: quizScores, error: quizScoresError } = useQuery({
    queryKey: ["quiz-scores", courseId],
    queryFn: () => listQuizScoresForCourse(courseId),
    enabled: !!courseId,
  });

  useEffect(() => {
    if (quizScoresError) toast.error("Could not load worksheet scores.");
  }, [quizScoresError]);

  useEffect(() => {
    if (!courses?.length && courseId) return;
    if (!courseId && courses?.length) setCourseId(courses[0]?.id ?? "");
  }, [courses, courseId]);

  useEffect(() => {
    const next: Record<string, CellState> = {};
    const nextOverrides: OverridesState = {};
    (existing ?? []).forEach((g) => {
      next[g.student_id] = {
        ww: g.written_work_score?.toString() ?? "",
        pt: g.performance_task_score?.toString() ?? "",
        ex: g.exam_score?.toString() ?? "",
      };
      if (g.override_flags && typeof g.override_flags === "object") {
        const studentFlags: Partial<Record<ColumnKey, GradeOverrideFlag>> = {};
        (["ww", "pt", "ex"] as const).forEach((col) => {
          const flag = g.override_flags?.[col];
          if (flag) {
            studentFlags[col] = {
              note: flag.note ?? null,
              ...(flag.by ? { by: flag.by } : {}),
              ...(flag.at ? { at: flag.at } : {}),
            };
          }
        });
        if (Object.keys(studentFlags).length > 0) {
          nextOverrides[g.student_id] = studentFlags;
        }
      }
    });
    setCells(next);
    setOverrides(nextOverrides);
    setPublished((existing ?? []).length > 0);
  }, [existing]);

  useEffect(() => {
    setSection("all");
  }, [courseId]);

  const isLoading = !courses || !students || (gradeTab === "grades" && !allLogs);

  if (!profile) return null;

  if (isLoading)
    return (
      <AppShell nav={TEACHER_NAV} profile={profile} subtitle="Teacher Portal">
        <LoadingSkeleton />
      </AppShell>
    );

  // Roster is strictly the course's enrolled students — no grade-level
  // fallback, so a failed/empty enrollment query yields an empty roster
  // instead of widening it to the whole grade level.
  const roster = (students ?? []).filter((s) => !!enrolledIds?.includes(s.id));
  const sections = [
    ...new Set(roster.map((s) => s.section).filter((x): x is string => !!x)),
  ].sort();
  const sectionRoster = section === "all" ? roster : roster.filter((s) => s.section === section);
  const q = search.toLowerCase().trim();
  const visibleRoster = q
    ? sectionRoster.filter(
        (s) =>
          s.full_name.toLowerCase().includes(q) ||
          (s.student_id ?? "").toLowerCase().includes(q) ||
          (s.email ?? "").toLowerCase().includes(q) ||
          (s.section ?? "").toLowerCase().includes(q),
      )
    : sectionRoster;

  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.min(100, Number(v))));

  const preview = (sid: string) => {
    const c = cells[sid];
    if (!c) return null;
    const initial = weightedInitial(num(c.ww), num(c.pt), num(c.ex), attOf(sid));
    if (initial == null) return null;
    return { initial, t: transmute(initial) };
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      let n = 0;
      const valid = roster.filter((s) => {
        const c = cells[s.id];
        const ovr = overrides[s.id];
        const hasScores = c && (c.ww !== "" || c.pt !== "" || c.ex !== "");
        const hasOverrides = ovr && (ovr.ww || ovr.pt || ovr.ex);
        return hasScores || hasOverrides;
      });
      await Promise.all(
        valid.map((s) => {
          const c = cells[s.id] ?? { ww: "", pt: "", ex: "" };
          const initial = weightedInitial(num(c.ww), num(c.pt), num(c.ex), attOf(s.id));
          const override_flags = extractOverrideFlagsPayload(overrides[s.id]);
          return upsertGrade({
            student_id: s.id,
            course_id: courseId,
            quarter,
            written_work_score: num(c.ww),
            performance_task_score: num(c.pt),
            exam_score: num(c.ex),
            transmuted_final_grade: initial != null ? transmute(initial) : null,
            override_flags,
          });
        }),
      );
      n = valid.length;
      toast.success(`Saved and published grades for ${n} student${n === 1 ? "" : "s"}.`);
      setPublished(true);
      qc.invalidateQueries({ queryKey: ["course-grades", courseId, quarter] });
      qc.invalidateQueries({ queryKey: ["grades"] });
    } catch {
      toast.error("Could not save grades.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleOverride = (studentId: string, col: ColumnKey) => {
    setOverrides((prev) => {
      const studentOvr = { ...(prev[studentId] ?? {}) };
      if (studentOvr[col]) {
        delete studentOvr[col];
      } else {
        studentOvr[col] = { note: null };
      }
      return { ...prev, [studentId]: studentOvr };
    });
  };

  const handleUpdateOverrideNote = (studentId: string, col: ColumnKey, note: string) => {
    setOverrides((prev) => {
      const studentOvr = { ...(prev[studentId] ?? {}) };
      const existingFlag = studentOvr[col] ?? {};
      const trimmed = note.trim();
      studentOvr[col] = {
        ...existingFlag,
        note: trimmed ? trimmed.slice(0, 500) : null,
      };
      return { ...prev, [studentId]: studentOvr };
    });
  };

  const handleBulkFill = (col: ColumnKey, score: string, note: string) => {
    const visibleIds = visibleRoster.map((s) => s.id);
    const res = applyBulkColumnFill(cells, overrides, visibleIds, col, score, note);
    setCells(res.cells);
    setOverrides(res.overrides);
    toast.success(
      `Filled ${COLUMN_CONFIG[col].short} for ${visibleIds.length} visible student${visibleIds.length === 1 ? "" : "s"}.`,
    );
  };

  const handleClearColumnOverrides = (col: ColumnKey) => {
    const visibleIds = visibleRoster.map((s) => s.id);
    const nextOverrides = clearColumnOverridesForRoster(overrides, visibleIds, col);
    setOverrides(nextOverrides);
    toast.success(
      `Cleared ${COLUMN_CONFIG[col].short} overrides for ${visibleIds.length} visible student${visibleIds.length === 1 ? "" : "s"}.`,
    );
  };

  const handleApplyImport = async (
    updatedCells: Record<string, CellState>,
    updatedOverrides: OverridesState,
    appliedCount: number,
    saveImmediately = false,
  ) => {
    setCells(updatedCells);
    setOverrides(updatedOverrides);
    if (saveImmediately) {
      setSaving(true);
      try {
        const valid = roster.filter((s) => {
          const c = updatedCells[s.id];
          const ovr = updatedOverrides[s.id];
          const hasScores = c && (c.ww !== "" || c.pt !== "" || c.ex !== "");
          const hasOverrides = ovr && (ovr.ww || ovr.pt || ovr.ex);
          return hasScores || hasOverrides;
        });
        await Promise.all(
          valid.map((s) => {
            const c = updatedCells[s.id] ?? { ww: "", pt: "", ex: "" };
            const initial = weightedInitial(num(c.ww), num(c.pt), num(c.ex), attOf(s.id));
            const override_flags = extractOverrideFlagsPayload(updatedOverrides[s.id]);
            return upsertGrade({
              student_id: s.id,
              course_id: courseId,
              quarter,
              written_work_score: num(c.ww),
              performance_task_score: num(c.pt),
              exam_score: num(c.ex),
              transmuted_final_grade: initial != null ? transmute(initial) : null,
              override_flags,
            });
          }),
        );
        toast.success(
          `Imported and published grades for ${appliedCount} student${appliedCount === 1 ? "" : "s"}.`,
        );
        setPublished(true);
        qc.invalidateQueries({ queryKey: ["course-grades", courseId, quarter] });
        qc.invalidateQueries({ queryKey: ["grades"] });
      } catch {
        toast.error("Could not save imported grades.");
      } finally {
        setSaving(false);
      }
    } else {
      toast.success(
        `Applied grades for ${appliedCount} student${appliedCount === 1 ? "" : "s"} to gradebook. Review changes and click Save & publish.`,
      );
    }
  };

  const exportCsv = () => {
    const header = [
      "Student No",
      "Name",
      "Section",
      "Attendance (10%)",
      "WW (20%)",
      "PT (40%)",
      "Exam (30%)",
      "Initial",
      "Transmuted",
      "Remarks",
      "Overrides",
    ];
    const rows = visibleRoster.map((s) => {
      const c = cells[s.id] ?? { ww: "", pt: "", ex: "" };
      const p = preview(s.id);
      const ovr = formatOverridesSummary(overrides[s.id]);
      return [
        s.student_id ?? "",
        s.full_name,
        s.section ?? "",
        attOf(s.id) ?? "",
        c.ww,
        c.pt,
        c.ex,
        p ? p.initial.toFixed(1) : "",
        p ? String(p.t) : "",
        p ? gradeRemarks(p.t) : "",
        ovr,
      ];
    });
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${course?.code ?? "grades"}-Q${quarter}${section === "all" ? "" : `-${section}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported.");
  };

  const exportXlsx = () => {
    const header: XlsxCell[] = [
      "Student No",
      "Name",
      "Section",
      "Attendance (10%)",
      "WW (20%)",
      "PT (40%)",
      "Exam (30%)",
      "Initial",
      "Transmuted",
      "Remarks",
      "Overrides",
    ];
    const body: XlsxCell[][] = visibleRoster.map((s) => {
      const c = cells[s.id] ?? { ww: "", pt: "", ex: "" };
      const p = preview(s.id);
      const ovr = formatOverridesSummary(overrides[s.id]);
      return [
        s.student_id ?? "",
        s.full_name,
        s.section ?? "",
        attOf(s.id) ?? "",
        c.ww,
        c.pt,
        c.ex,
        p ? Number(p.initial.toFixed(1)) : "",
        p ? p.t : "",
        p ? gradeRemarks(p.t) : "",
        ovr,
      ];
    });
    const termTag = termLabel(quarter, course).replace(/[^A-Za-z0-9]+/g, "-");
    const blob = buildXlsx([{ name: "Grades", rows: [header, ...body] }]);
    downloadBlob(
      blob,
      `${course?.code ?? "grades"}-${termTag}${section === "all" ? "" : `-${section}`}.xlsx`,
    );
    toast.success("Excel exported.");
  };

  return (
    <AppShell nav={TEACHER_NAV} profile={profile} subtitle="Teacher Portal">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Gradebook</h1>
        {published && <Badge tone="green">Published</Badge>}
      </div>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        {gradeTab === "class"
          ? "Record individual quizzes, examinations and performance tasks, then review class attendance. Save drafts while working; publish complete records when ready. Weights: Attendance 10% · Written Works 20% · Examination 30% · Performance Tasks 40%."
          : "Legacy category summary: enter component percentages (0–100). Records published from Class Record must be revised and republished in that tab."}
      </p>

      <div className="mb-5 flex flex-wrap gap-3">
        <select
          value={courseId}
          onChange={(e) => {
            if (leaveRecord()) {
              setRecordDirty(false);
              setCourseId(e.target.value);
            }
          }}
          aria-label="Select course"
          className="h-11 min-w-56 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {(courses ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title} ({courseLevelLabel(c)})
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {termOptions(course).map((q) => (
            <button
              key={q}
              onClick={() => {
                if (leaveRecord()) {
                  setRecordDirty(false);
                  setQuarter(q);
                }
              }}
              className={cn(
                "rounded-lg px-3 py-2 text-xs font-semibold sm:text-sm",
                quarter === q ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              {termLabel(q, course)}
            </button>
          ))}
        </div>
        {sections.length > 1 && (
          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            aria-label="Filter by section"
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All sections</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search students"
            placeholder="Search name, student no., email or section..."
            className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          )}
        </div>
        {gradeTab !== "class" && (
          <div className="ml-auto flex flex-wrap gap-2">
            {profile.role === "teacher" && (
              <button
                onClick={() => setImportOpen(true)}
                disabled={!courseId || roster.length === 0}
                className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
                title="Import grades from Excel or CSV spreadsheet"
              >
                <FileUp className="h-4 w-4" /> Import
              </button>
            )}
            <button
              onClick={exportCsv}
              disabled={!courseId || visibleRoster.length === 0}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> CSV
            </button>
            <button
              onClick={exportXlsx}
              disabled={!courseId || visibleRoster.length === 0}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </button>
            {profile.role === "teacher" ? (
              <button
                onClick={saveAll}
                disabled={saving || !courseId}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Send className="h-4 w-4" /> {saving ? "Publishing…" : "Save & publish"}
              </button>
            ) : (
              <p className="self-center text-xs text-muted-foreground">
                View-only — only the course teacher can publish grades.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Tab Switcher ─────────────────────────────────────────── */}
      {courseId && (
        <div className="flex gap-1 rounded-xl bg-muted p-1 mb-5 w-fit">
          <button
            onClick={() => {
              if (leaveRecord()) {
                setRecordDirty(false);
                setGradeTab("grades");
              }
            }}
            className={cn(
              "rounded-lg px-5 py-2 text-sm font-semibold transition",
              gradeTab === "grades"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Category summary (legacy)
          </button>
          <button
            onClick={() => {
              if (leaveRecord()) {
                setRecordDirty(false);
                setGradeTab("quizzes");
              }
            }}
            className={cn(
              "rounded-lg px-5 py-2 text-sm font-semibold transition",
              gradeTab === "quizzes"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Quiz Scores {quizScores && quizScores.length > 0 ? `(${quizScores.length})` : ""}
          </button>
          <button
            onClick={() => setGradeTab("class")}
            className={cn(
              "rounded-lg px-5 py-2 text-sm font-semibold transition",
              gradeTab === "class"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Class Record
          </button>
        </div>
      )}

      {/* ── Grades Tab ───────────────────────────────────────────── */}
      {gradeTab === "grades" && (
        <>
          {!courseId || visibleRoster.length === 0 ? (
            <EmptyState
              title="No students on this roster"
              sub="Enroll students or pick another course or section."
            />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="p-4">Student</th>
                    <th className="p-4 text-center">Att (10%)</th>
                    <th className="p-4 text-center">
                      <div className="inline-flex items-center justify-center gap-1.5">
                        <span>WW (20%)</span>
                        <BulkColumnMenu
                          columnKey="ww"
                          columnTitle="WW"
                          visibleCount={visibleRoster.length}
                          onOpenFill={() => setBulkFillColumn("ww")}
                          onClear={() => handleClearColumnOverrides("ww")}
                        />
                      </div>
                    </th>
                    <th className="p-4 text-center">
                      <div className="inline-flex items-center justify-center gap-1.5">
                        <span>PT (40%)</span>
                        <BulkColumnMenu
                          columnKey="pt"
                          columnTitle="PT"
                          visibleCount={visibleRoster.length}
                          onOpenFill={() => setBulkFillColumn("pt")}
                          onClear={() => handleClearColumnOverrides("pt")}
                        />
                      </div>
                    </th>
                    <th className="p-4 text-center">
                      <div className="inline-flex items-center justify-center gap-1.5">
                        <span>Exam (30%)</span>
                        <BulkColumnMenu
                          columnKey="ex"
                          columnTitle="Exam"
                          visibleCount={visibleRoster.length}
                          onOpenFill={() => setBulkFillColumn("ex")}
                          onClear={() => handleClearColumnOverrides("ex")}
                        />
                      </div>
                    </th>
                    <th className="p-4 text-center">Initial</th>
                    <th className="p-4 text-center">Transmuted</th>
                    <th className="p-4">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleRoster.map((s) => {
                    const c = cells[s.id] ?? { ww: "", pt: "", ex: "" };
                    const p = preview(s.id);
                    const setCell =
                      (k: keyof CellState) => (e: React.ChangeEvent<HTMLInputElement>) =>
                        setCells((all) => ({
                          ...all,
                          [s.id]: { ...c, [k]: sanitizeDecimal(e.target.value) },
                        }));
                    return (
                      <tr key={s.id}>
                        <td className="p-4">
                          <div className="flex items-center gap-2.5">
                            <UserAvatar src={s.avatar_url} name={s.full_name} />
                            <div>
                              <p className="font-semibold">{s.full_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {s.student_id} · {s.section}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-center text-muted-foreground">
                          {attOf(s.id) ?? "—"}
                        </td>
                        {(["ww", "pt", "ex"] as const).map((k) => {
                          const isOverridden = !!overrides[s.id]?.[k];
                          const overrideFlag = overrides[s.id]?.[k] ?? null;
                          return (
                            <td key={k} className="p-4 text-center">
                              <div className="inline-flex items-center justify-center gap-1">
                                <input
                                  value={c[k]}
                                  onChange={setCell(k)}
                                  inputMode="decimal"
                                  placeholder="—"
                                  aria-label={`${k === "ww" ? "Written work" : k === "pt" ? "Performance task" : "Exam"} score for ${s.full_name}`}
                                  className={cn(
                                    "h-9 w-20 rounded-lg border border-input bg-background text-center text-sm outline-none transition-colors focus:ring-2 focus:ring-ring",
                                    isOverridden &&
                                      "border-amber-500/70 border-l-[3px] border-l-amber-500 bg-amber-500/5 font-medium dark:border-amber-400/60 dark:border-l-amber-400 dark:bg-amber-400/10",
                                  )}
                                />
                                <OverrideFlagToggle
                                  studentName={s.full_name}
                                  columnKey={k}
                                  override={overrideFlag}
                                  onToggle={() => handleToggleOverride(s.id, k)}
                                  onUpdateNote={(note) => handleUpdateOverrideNote(s.id, k, note)}
                                />
                              </div>
                            </td>
                          );
                        })}
                        <td className="p-4 text-center">{p ? p.initial.toFixed(1) : "—"}</td>
                        <td className="p-4 text-center">
                          <span
                            className={cn(
                              "font-display text-base font-bold",
                              p && p.t < 75 && "text-rose-600 dark:text-rose-400",
                            )}
                          >
                            {p ? p.t : "—"}
                          </span>
                        </td>
                        <td className="p-4">
                          {p ? (
                            <Badge
                              tone={
                                p.t >= 90
                                  ? "green"
                                  : p.t >= 80
                                    ? "indigo"
                                    : p.t >= 75
                                      ? "amber"
                                      : "red"
                              }
                            >
                              {gradeRemarks(p.t)}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {/* ── Quiz Scores Tab ──────────────────────────────────────── */}
      {gradeTab === "quizzes" && courseId && (
        <div>
          <p className="mb-4 text-xs text-muted-foreground">
            Best score per student per worksheet. Use these to inform the Written Work (WW)
            component in the Grades tab.
          </p>
          {!quizScores || quizScores.length === 0 ? (
            <EmptyState
              title="No worksheet scores yet"
              sub="Students need to submit worksheets for scores to appear here."
            />
          ) : visibleRoster.length === 0 ? (
            <EmptyState
              title="No students on this roster"
              sub="Enroll students or pick another course or section."
            />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="p-4 sticky left-0 bg-card z-10">Student</th>
                    {quizScores.map((q) => (
                      <th
                        key={q.quiz_id}
                        className="p-4 text-center max-w-[140px] truncate"
                        title={q.title}
                      >
                        {q.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleRoster.map((s) => (
                    <tr key={s.id}>
                      <td className="p-4 sticky left-0 bg-card z-10">
                        <p className="font-semibold">{s.full_name}</p>
                        <p className="text-xs text-muted-foreground">{s.student_id}</p>
                      </td>
                      {quizScores.map((q) => {
                        const score = q.scores[s.id];
                        if (!score)
                          return (
                            <td key={q.quiz_id} className="p-4 text-center text-muted-foreground">
                              —
                            </td>
                          );
                        const pct =
                          score.total > 0 ? Math.round((score.score / score.total) * 100) : 0;
                        return (
                          <td key={q.quiz_id} className="p-4 text-center">
                            <span
                              className={cn(
                                "font-semibold",
                                pct >= 90
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : pct >= 75
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-rose-600 dark:text-rose-400",
                              )}
                            >
                              {score.score}/{score.total}
                            </span>
                            <span className="ml-1 text-xs text-muted-foreground">({pct}%)</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {/* ── Class Record Tab ─────────────────────────────────────── */}
      {gradeTab === "class" && courseId && (
        <ClassRecord
          key={`${courseId}:${quarter}`}
          courseId={courseId}
          courseCode={course?.code ?? ""}
          quarter={quarter}
          roster={roster}
          visibleRoster={visibleRoster}
          editable={profile.role === "teacher"}
          onDirtyChange={setRecordDirty}
        />
      )}

      <BulkFillModal
        open={bulkFillColumn !== null}
        onClose={() => setBulkFillColumn(null)}
        columnKey={bulkFillColumn}
        columnTitle={bulkFillColumn ? COLUMN_CONFIG[bulkFillColumn].label : ""}
        visibleCount={visibleRoster.length}
        activeSection={section}
        onApply={(score, note) => {
          if (bulkFillColumn) {
            handleBulkFill(bulkFillColumn, score, note);
          }
        }}
      />

      <GradebookImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        course={course}
        quarter={quarter}
        roster={roster}
        currentCells={cells}
        currentOverrides={overrides}
        attOf={attOf}
        onApply={handleApplyImport}
      />
    </AppShell>
  );
}
