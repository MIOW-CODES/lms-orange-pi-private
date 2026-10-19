import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Calendar,
  ClipboardList,
  FileQuestion,
  FileSpreadsheet,
  Library,
  Plus,
  Search,
  Table,
  UserPlus,
  Users,
} from "lucide-react";
import { type Assignment, type Course, type Profile, type Quiz, formatSchedule } from "@/lib/lms";
import { Badge, Card, EmptyState, courseStyle } from "@/components/lms";
import { courseLevelLabel } from "@/lib/course-levels";
import { UserAvatar } from "@/components/ui-elements";
import { WorksheetsSection } from "@/components/courses/worksheets-section";
import { AssignmentsSection } from "@/components/courses/assignments-section";
import { ClassRecord } from "@/components/courses/class-record";
import { QuestionBank } from "@/components/courses/question-bank";
import { TosView } from "@/components/courses/tos-view";
import { EnrollStudentsModal } from "@/components/courses/enroll-students-modal";
import { MeetingsPanel } from "@/components/courses/meetings-panel";
import { SectionsPanel } from "@/components/courses/sections-panel";
import { useCourseRoster } from "@/hooks/useCourseWorkspace";
import { useProfile } from "@/hooks";
import { termOptions, termLabel } from "@/lib/lms";
import { cn } from "@/lib/utils";

/** One tab inside a course workspace. */
export interface WorkspaceTab {
  id: string;
  label: string;
  icon: ReactNode;
  /** Omit for no badge; use "…" while the count is still loading — 0 is reserved for confirmed empty. */
  count?: number | string;
}

/** Breadcrumb + hero header + tab bar shared by staff and student workspaces. */
export function CourseWorkspaceShell({
  course,
  onBack,
  tabs,
  activeTab,
  onTabChange,
  actions,
  children,
}: {
  course: Course;
  onBack: () => void;
  tabs: WorkspaceTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const st = courseStyle(course.color);
  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All courses
      </button>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className={cn("h-2", st.chip)} />
        <div className="flex flex-wrap items-start justify-between gap-3 p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold", st.soft)}>
                {course.code}
              </span>
              <Badge tone="slate">{courseLevelLabel(course)}</Badge>
            </div>
            <h1 className="mt-2 font-display text-xl font-bold leading-snug sm:text-2xl">
              {course.title}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {course.teacher_name ?? "No teacher assigned"}
            </p>
            {formatSchedule(course) && (
              <p className="mt-1 text-xs font-medium text-primary">{formatSchedule(course)}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
              activeTab === t.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {t.icon}
            {t.label}
            {t.count != null && (
              <span
                className={cn(
                  "ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                  activeTab === t.id ? "bg-white/20" : "bg-muted-foreground/10",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4">{children}</div>
    </div>
  );
}

/** Enrolled-student roster for one course, with search. */
export function CourseRoster({
  courseId,
  courseLabel,
  roster,
  loading,
}: {
  courseId: string;
  courseLabel?: string;
  roster: Profile[];
  loading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("all");
  const [enrollOpen, setEnrollOpen] = useState(false);

  // Distinct sections across enrolled students, for the section filter.
  const sections = useMemo(
    () => [...new Set(roster.map((s) => s.section).filter((x): x is string => !!x))].sort(),
    [roster],
  );
  const sectionRoster = useMemo(
    () => (section === "all" ? roster : roster.filter((s) => s.section === section)),
    [roster, section],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sectionRoster;
    return sectionRoster.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        (s.student_id ?? "").toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q),
    );
  }, [sectionRoster, search]);

  // Show the filtered count while a search or section filter is active.
  const filtering = section !== "all" || search.trim() !== "";

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Enrolled students</p>
          <p className="text-xs text-muted-foreground">
            {loading ? (
              <span className="inline-block h-3.5 w-24 animate-pulse rounded bg-muted align-middle" />
            ) : filtering ? (
              `${visible.length} of ${roster.length} learner${roster.length !== 1 ? "s" : ""}`
            ) : (
              `${roster.length} learner${roster.length !== 1 ? "s" : ""} in this course`
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sections.length > 0 && (
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
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or ID"
              aria-label="Search enrolled students"
              className="h-9 w-56 rounded-lg border border-input bg-background pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <button
            onClick={() => setEnrollOpen(true)}
            className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            <UserPlus className="h-3.5 w-3.5" /> Enroll students
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {roster.length === 0
            ? "No students enrolled yet — use “Enroll students” to add existing learners."
            : "No students match your search or section filter."}
        </p>
      ) : (
        <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
          {visible.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/50 px-3 py-2"
            >
              <UserAvatar name={s.full_name} src={s.avatar_url} className="h-8 w-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{s.full_name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {s.student_id ?? "—"}
                  {s.section ? ` · ${s.section}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <EnrollStudentsModal
        courseId={courseId}
        {...(courseLabel ? { courseLabel } : {})}
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        enrolledIds={roster.map((s) => s.id)}
      />
    </Card>
  );
}

/**
 * Staff (admin/teacher) view for a single course: worksheets, assignments,
 * class record and roster — all scoped to this course only.
 */
export function StaffCourseWorkspace({
  course,
  quizzes,
  assignments,
  onBack,
  onNewQuiz,
  onNewAssignment,
  onPolicy,
  onEditQuiz,
  onRemoveQuiz,
  onRoster,
  onEditAssignment,
  onRemoveAssignment,
  onSubmissions,
  loading = false,
}: {
  course: Course;
  quizzes: Quiz[];
  assignments: Assignment[];
  onBack: () => void;
  onNewQuiz: () => void;
  onNewAssignment: () => void;
  onPolicy: (q: Quiz) => void;
  onEditQuiz: (q: Quiz) => void;
  onRemoveQuiz: (q: Quiz) => void;
  onRoster: (q: Quiz) => void;
  onEditAssignment: (a: Assignment) => void;
  onRemoveAssignment: (a: Assignment) => void;
  onSubmissions: (a: Assignment) => void;
  /** Worksheets/assignments lists are still loading — reserve 0 for confirmed empty. */
  loading?: boolean;
}) {
  const [tab, setTab] = useState("worksheets");
  const profile = useProfile();
  const [recordQuarter, setRecordQuarter] = useState(1);
  const [recordDirty, setRecordDirty] = useState(false);
  const { roster, loading: rosterLoading } = useCourseRoster(course.id);

  const courseQuizzes = useMemo(
    () => quizzes.filter((q) => q.course_id === course.id),
    [quizzes, course.id],
  );
  const courseAssignments = useMemo(
    () => assignments.filter((a) => a.course_id === course.id),
    [assignments, course.id],
  );

  const tabs: WorkspaceTab[] = [
    {
      id: "worksheets",
      label: "Worksheets",
      icon: <FileQuestion className="h-4 w-4" />,
      count: loading ? "…" : courseQuizzes.length,
    },
    {
      id: "assignments",
      label: "Assignments",
      icon: <ClipboardList className="h-4 w-4" />,
      count: loading ? "…" : courseAssignments.length,
    },
    { id: "class", label: "Class Record", icon: <FileSpreadsheet className="h-4 w-4" /> },
    { id: "tos", label: "TOS", icon: <Table className="h-4 w-4" /> },
    { id: "bank", label: "Question Bank", icon: <Library className="h-4 w-4" /> },
    {
      id: "roster",
      label: "Students",
      icon: <Users className="h-4 w-4" />,
      count: rosterLoading ? "…" : roster.length,
    },
    {
      id: "schedule",
      label: "Schedule & Sections",
      icon: <Calendar className="h-4 w-4" />,
    },
  ];

  return (
    <CourseWorkspaceShell
      course={course}
      onBack={onBack}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(next) => {
        if (!recordDirty || window.confirm("Discard unsaved class-record changes?")) {
          setRecordDirty(false);
          setTab(next);
        }
      }}
      actions={
        <>
          <button
            onClick={onNewQuiz}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-semibold hover:bg-muted"
          >
            <Plus className="h-4 w-4" /> Worksheet
          </button>
          <button
            onClick={onNewAssignment}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Assignment
          </button>
        </>
      }
    >
      {tab === "worksheets" &&
        (loading ? (
          <Card className="p-6 text-sm text-muted-foreground">Loading worksheets…</Card>
        ) : courseQuizzes.length === 0 ? (
          <EmptyState
            title="No worksheets yet"
            sub="Create a worksheet for this course — generate one with ClassMate or build it manually."
          />
        ) : (
          <WorksheetsSection
            quizzes={courseQuizzes}
            courses={[course]}
            onPolicy={onPolicy}
            onEdit={onEditQuiz}
            onRemove={onRemoveQuiz}
            onRoster={onRoster}
          />
        ))}

      {tab === "assignments" &&
        (loading ? (
          <Card className="p-6 text-sm text-muted-foreground">Loading assignments…</Card>
        ) : courseAssignments.length === 0 ? (
          <EmptyState
            title="No assignments yet"
            sub="Post an assignment, attach handouts and grade student submissions here."
          />
        ) : (
          <AssignmentsSection
            assignments={courseAssignments}
            courses={[course]}
            onEdit={onEditAssignment}
            onRemove={onRemoveAssignment}
            onSubmissions={onSubmissions}
          />
        ))}

      {tab === "class" &&
        (rosterLoading ? (
          <Card className="p-6 text-sm text-muted-foreground">Loading class record…</Card>
        ) : (
          <div>
            <label className="mb-4 block text-sm">
              Grading period
              <select
                className="ml-3 h-10 rounded-lg border border-input bg-background px-3"
                value={recordQuarter}
                onChange={(e) => {
                  if (!recordDirty || window.confirm("Discard unsaved class-record changes?")) {
                    setRecordDirty(false);
                    setRecordQuarter(Number(e.target.value));
                  }
                }}
              >
                {termOptions(course).map((q) => (
                  <option key={q} value={q}>
                    {termLabel(q, course)}
                  </option>
                ))}
              </select>
            </label>
            <ClassRecord
              key={`${course.id}:${recordQuarter}`}
              courseId={course.id}
              courseCode={course.code}
              quarter={recordQuarter}
              roster={roster}
              editable={profile?.role === "teacher"}
              onDirtyChange={setRecordDirty}
            />
          </div>
        ))}

      {tab === "tos" && <TosView course={course} />}

      {tab === "bank" && <QuestionBank courseId={course.id} />}

      {tab === "roster" && (
        <CourseRoster
          courseId={course.id}
          courseLabel={`${course.code} · ${course.title}`}
          roster={roster}
          loading={rosterLoading}
        />
      )}

      {tab === "schedule" && (
        <div className="space-y-6">
          <SectionsPanel courseId={course.id} />
          <MeetingsPanel courseId={course.id} />
        </div>
      )}
    </CourseWorkspaceShell>
  );
}
