import { lazy, Suspense, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileQuestion,
  Paperclip,
} from "lucide-react";
import {
  COMPONENT_LABELS,
  daysUntil,
  enrollmentsForStudent,
  fmtDate,
  listAssignments,
  listCourseMeetings,
  listCourses,
  listQuizzes,
  listSubmissionsForStudent,
  materialHref,
  myQuizSummaries,
  requestWorksheetRetake,
  formatSchedule,
  type Assignment,
  type Course,
  type CourseMeeting,
  type Quiz,
  type QuizAttemptSummary,
  type Submission,
} from "@/lib/lms";
import {
  AppShell,
  Badge,
  EmptyState,
  MotionCard,
  Modal,
  STUDENT_NAV,
  courseStyle,
  useProfile,
} from "@/components/lms";
import { courseLevelLabel } from "@/lib/course-levels";
import { assignmentActionLabel, worksheetActionLabel } from "@/lib/assessment-actions";
import { cn } from "@/lib/utils";
import { LoadError, LoadingSkeleton } from "@/components/ui-elements";
import { CourseWorkspaceShell, type WorkspaceTab } from "@/components/courses/course-workspace";
import { DAYS } from "@/components/courses/constants";
import { useCourseSelection } from "@/hooks/useCourseWorkspace";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useLockdown } from "@/hooks/useLockdown";
import { toast } from "sonner";
const WorksheetSession = lazy(() =>
  import("@/components/courses/worksheet-session").then((module) => ({
    default: module.WorksheetSession,
  })),
);

export const Route = createFileRoute("/dashboard/student/courses")({
  head: () => ({
    meta: [
      { title: "Courses | MIOW - Integrated Developmental School" },
      { name: "description", content: "View your enrolled courses, assignments and worksheets." },
      { property: "og:title", content: "Courses | MIOW - Integrated Developmental School" },
      {
        property: "og:description",
        content: "View your enrolled courses, assignments and worksheets.",
      },
    ],
  }),
  component: StudentCoursesPage,
});

type Tab = "courses" | "worksheets" | "assignments";

function StudentCoursesPage() {
  const profile = useProfile(["student"]);
  const [tab, setTab] = useState<Tab>("courses");
  const [selectedCourseId, selectCourse] = useCourseSelection();

  const coursesQuery = useQuery({
    queryKey: ["courses"],
    queryFn: listCourses,
    enabled: !!profile,
  });
  const { data: courses } = coursesQuery;
  const assignmentsQuery = useQuery({
    queryKey: ["assignments"],
    queryFn: listAssignments,
    enabled: !!profile,
  });
  const { data: assignments } = assignmentsQuery;
  const quizzesQuery = useQuery({
    queryKey: ["quizzes"],
    queryFn: listQuizzes,
    enabled: !!profile,
  });
  const { data: quizzes } = quizzesQuery;
  const submissionsQuery = useQuery({
    queryKey: ["submissions", profile?.id],
    queryFn: () => {
      if (!profile?.id) return [];
      return listSubmissionsForStudent(profile.id);
    },
    enabled: !!profile,
  });
  const { data: submissions } = submissionsQuery;
  const quizSummariesQuery = useQuery({
    queryKey: ["quiz-summaries"],
    queryFn: myQuizSummaries,
    enabled: !!profile,
  });
  const { data: quizSummaries } = quizSummariesQuery;
  const enrollmentsQuery = useQuery({
    queryKey: ["enrollments", "student", profile?.id],
    queryFn: () => enrollmentsForStudent(profile!.id),
    enabled: !!profile?.id,
  });
  const { data: enrolledCourseIds } = enrollmentsQuery;

  // The server returns only the courses this student is enrolled in; keep the
  // enrollment check as display-only belt-and-braces. Grade level is NOT a
  // fallback — it must never widen visibility beyond enrollment.
  const myCourses = useMemo(() => {
    const enrolled = new Set(enrolledCourseIds ?? []);
    return (courses ?? []).filter((c) => enrolled.has(c.id));
  }, [courses, enrolledCourseIds]);

  const courseIds = useMemo(() => new Set(myCourses.map((c) => c.id)), [myCourses]);
  const myAssignments = (assignments ?? []).filter((a) => courseIds.has(a.course_id));
  const myQuizzes = (quizzes ?? []).filter((q) => courseIds.has(q.course_id));
  const subByAssignment = new Map((submissions ?? []).map((s) => [s.assignment_id, s]));
  const summaryByQuiz = new Map((quizSummaries ?? []).map((s) => [s.quiz_id, s]));

  const isLoading =
    !courses || !assignments || !quizzes || !submissions || !quizSummaries || !enrolledCourseIds;

  if (!profile) return null;

  const failedQuery = [
    coursesQuery,
    assignmentsQuery,
    quizzesQuery,
    submissionsQuery,
    quizSummariesQuery,
    enrollmentsQuery,
  ].find((query) => query.isError);

  if (failedQuery)
    return (
      <AppShell nav={STUDENT_NAV} profile={profile} subtitle="Student Portal">
        <LoadError
          what="courses"
          onRetry={() => {
            void Promise.all([
              coursesQuery.refetch(),
              assignmentsQuery.refetch(),
              quizzesQuery.refetch(),
              submissionsQuery.refetch(),
              quizSummariesQuery.refetch(),
              enrollmentsQuery.refetch(),
            ]);
          }}
        />
      </AppShell>
    );

  if (isLoading)
    return (
      <AppShell nav={STUDENT_NAV} profile={profile} subtitle="Student Portal">
        <LoadingSkeleton />
      </AppShell>
    );

  const selectedCourse = myCourses.find((c) => c.id === selectedCourseId) ?? null;

  if (selectedCourse) {
    return (
      <AppShell nav={STUDENT_NAV} profile={profile} subtitle="Student Portal">
        <StudentCourseWorkspace
          course={selectedCourse}
          quizzes={myQuizzes.filter((q) => q.course_id === selectedCourse.id)}
          assignments={myAssignments.filter((a) => a.course_id === selectedCourse.id)}
          subByAssignment={subByAssignment}
          summaryByQuiz={summaryByQuiz}
          onBack={() => selectCourse(null)}
        />
      </AppShell>
    );
  }

  const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode; count: number }> = [
    {
      id: "courses",
      label: "Courses",
      icon: <BookOpen className="h-4 w-4" />,
      count: myCourses.length,
    },
    {
      id: "worksheets",
      label: "Worksheets",
      icon: <FileQuestion className="h-4 w-4" />,
      count: myQuizzes.length,
    },
    {
      id: "assignments",
      label: "Assignments",
      icon: <ClipboardList className="h-4 w-4" />,
      count: myAssignments.length,
    },
  ];

  return (
    <AppShell nav={STUDENT_NAV} profile={profile} subtitle="Student Portal">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Courses</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {myCourses.length} enrolled course{myCourses.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
              tab === t.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {t.icon}
            {t.label}
            <span
              className={cn(
                "ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                tab === t.id ? "bg-white/20" : "bg-muted-foreground/10",
              )}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Courses tab ─────────────────────────────────────────────── */}
      {tab === "courses" && (
        <>
          {myCourses.length === 0 ? (
            <EmptyState title="No courses yet" sub="Your enrolled courses will appear here." />
          ) : (
            <>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Select a course to see its worksheets, assignments and materials
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {myCourses.map((c, i) => {
                  const st = courseStyle(c.color);
                  const courseAssignments = myAssignments.filter((a) => a.course_id === c.id);
                  const courseQuizzes = myQuizzes.filter((q) => q.course_id === c.id);
                  return (
                    <MotionCard
                      key={c.id}
                      delay={Math.min(i * 0.05, 0.3)}
                      className="overflow-hidden"
                    >
                      <div className={cn("h-2", st.chip)} />
                      <div className="p-5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-muted-foreground">{c.code}</p>
                          <Badge tone="slate">{courseLevelLabel(c)}</Badge>
                        </div>
                        <button
                          type="button"
                          onClick={() => selectCourse(c.id)}
                          aria-label={`Open course ${c.code} — ${c.title}`}
                          className="mt-1.5 block text-left font-semibold leading-snug hover:text-primary"
                        >
                          {c.title}
                        </button>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {c.teacher_name ?? "TBA"}
                        </p>
                        {formatSchedule(c) && (
                          <p className="mt-1 text-xs font-medium text-primary">
                            {formatSchedule(c)}
                          </p>
                        )}
                        <p className="mt-3 text-xs font-semibold text-muted-foreground">
                          {courseAssignments.length} assignment
                          {courseAssignments.length !== 1 ? "s" : ""} · {courseQuizzes.length}{" "}
                          worksheet
                          {courseQuizzes.length !== 1 ? "s" : ""}
                        </p>
                        <button
                          type="button"
                          onClick={() => selectCourse(c.id)}
                          aria-label={`Open course ${c.code} — ${c.title}`}
                          className="mt-3 flex h-9 w-full items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary hover:bg-primary/15"
                        >
                          Open course →
                        </button>
                      </div>
                    </MotionCard>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Worksheets tab ──────────────────────────────────────────── */}
      {tab === "worksheets" && (
        <>
          {myQuizzes.length === 0 ? (
            <EmptyState
              title="No worksheets yet"
              sub="Worksheets posted by your teacher will appear here."
            />
          ) : (
            <div className="grid gap-2">
              {myQuizzes.map((q) => (
                <StudentWorksheetRow
                  key={q.id}
                  quiz={q}
                  course={myCourses.find((c) => c.id === q.course_id)}
                  summary={summaryByQuiz.get(q.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Assignments tab ─────────────────────────────────────────── */}
      {tab === "assignments" && (
        <>
          {myAssignments.length === 0 ? (
            <EmptyState
              title="No assignments yet"
              sub="Activities posted by your teacher will appear here."
            />
          ) : (
            <div className="grid gap-2">
              {myAssignments.map((a) => (
                <StudentAssignmentRow
                  key={a.id}
                  assignment={a}
                  course={myCourses.find((c) => c.id === a.course_id)}
                  submission={subByAssignment.get(a.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

/** Student view of a single course: its worksheets and assignments. */
function StudentCourseWorkspace({
  course,
  quizzes,
  assignments,
  subByAssignment,
  summaryByQuiz,
  onBack,
}: {
  course: Course;
  quizzes: Quiz[];
  assignments: Assignment[];
  subByAssignment: Map<string, Submission>;
  summaryByQuiz: Map<string, QuizAttemptSummary>;
  onBack: () => void;
}) {
  const [tab, setTab] = useState("worksheets");

  const tabs: WorkspaceTab[] = [
    {
      id: "worksheets",
      label: "Worksheets",
      icon: <FileQuestion className="h-4 w-4" />,
      count: quizzes.length,
    },
    {
      id: "assignments",
      label: "Assignments",
      icon: <ClipboardList className="h-4 w-4" />,
      count: assignments.length,
    },
    {
      id: "schedule",
      label: "Schedule",
      icon: <CalendarDays className="h-4 w-4" />,
    },
  ];

  return (
    <CourseWorkspaceShell
      course={course}
      onBack={onBack}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
    >
      {tab === "worksheets" &&
        (quizzes.length === 0 ? (
          <EmptyState
            title="No worksheets yet"
            sub="Worksheets posted by your teacher will appear here."
          />
        ) : (
          <div className="grid gap-2">
            {quizzes.map((q) => (
              <StudentWorksheetRow
                key={q.id}
                quiz={q}
                course={course}
                summary={summaryByQuiz.get(q.id)}
              />
            ))}
          </div>
        ))}

      {tab === "assignments" &&
        (assignments.length === 0 ? (
          <EmptyState
            title="No assignments yet"
            sub="Activities posted by your teacher will appear here."
          />
        ) : (
          <div className="grid gap-2">
            {assignments.map((a) => (
              <StudentAssignmentRow
                key={a.id}
                assignment={a}
                course={course}
                submission={subByAssignment.get(a.id)}
              />
            ))}
          </div>
        ))}

      {tab === "schedule" && <StudentCourseSchedule courseId={course.id} />}
    </CourseWorkspaceShell>
  );
}

function formatStudentTime12(time24: string): string {
  if (!time24) return "";
  const parts = time24.split(":");
  const p0 = parts[0];
  const p1 = parts[1];
  if (!p0 || !p1) return time24;
  const hours = parseInt(p0, 10);
  const minutes = parseInt(p1, 10);
  if (isNaN(hours) || isNaN(minutes)) return time24;
  const period = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${minutes.toString().padStart(2, "0")} ${period}`;
}

function formatStudentTimeRange(start: string, end: string): string {
  if (!start && !end) return "Time not set";
  if (!end) return formatStudentTime12(start);
  if (!start) return formatStudentTime12(end);
  return `${formatStudentTime12(start)} – ${formatStudentTime12(end)}`;
}

/** Read-only lecture/lab timetable for a course (staff configure it in MeetingsPanel). */
function StudentCourseSchedule({ courseId }: { courseId: string }) {
  const { data: meetings = [], isPending } = useQuery({
    queryKey: ["course-meetings", courseId],
    queryFn: () => listCourseMeetings(courseId),
  });

  if (isPending) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/60" />
        ))}
      </div>
    );
  }

  if (meetings.length === 0) {
    return (
      <EmptyState
        title="No schedule yet"
        sub="Your teacher's lecture and lab schedule for this course will appear here."
      />
    );
  }

  return (
    <div className="grid gap-3">
      {meetings.map((meeting: CourseMeeting) => (
        <div
          key={meeting.id}
          className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-4 transition-all hover:border-border sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={meeting.kind === "lab" ? "violet" : "indigo"}>
                {meeting.kind === "lab" ? "Laboratory" : "Lecture"}
              </Badge>
              <span className="text-sm font-semibold text-foreground">{meeting.label}</span>
              <span className="text-xs text-muted-foreground">
                · {formatStudentTimeRange(meeting.start_time, meeting.end_time)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {DAYS.map((d) =>
                meeting.days_of_week.includes(d.code) ? (
                  <span
                    key={d.code}
                    className="rounded-md border border-border/60 bg-muted/70 px-2 py-0.5 text-[11px] font-semibold text-foreground"
                  >
                    {d.label}
                  </span>
                ) : null,
              )}
            </div>
          </div>
          {meeting.capacity != null && (
            <div className="text-xs text-muted-foreground sm:text-right">
              {meeting.capacity} seat{meeting.capacity !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MaterialChips({ attachments }: { attachments: Quiz["attachments"] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {attachments.map((a) => (
        <a
          key={a.path}
          href={materialHref(a)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:underline"
        >
          <Paperclip className="h-2.5 w-2.5" />
          {a.name}
        </a>
      ))}
    </div>
  );
}

function StudentWorksheetRow({
  quiz,
  course,
  summary,
}: {
  quiz: Quiz;
  course?: Course | undefined;
  summary?: QuizAttemptSummary | undefined;
}) {
  const profile = useProfile(["student"]);
  const examLock = useLockdown();
  const [confirming, setConfirming] = useState(false);
  const [taking, setTaking] = useState(false);
  const [requestingRetake, setRequestingRetake] = useState(false);
  const queryClient = useQueryClient();
  const notYetOpen = !!quiz.opens_at && new Date(quiz.opens_at).getTime() > Date.now();
  const isClosed = !!quiz.closes_at && new Date(quiz.closes_at).getTime() <= Date.now();
  const used = summary?.attempts_used ?? 0;
  const started = used > 0;
  const canTake = !notYetOpen && !isClosed && (!summary || summary.can_retake);
  const canRequestRetake = started && !!summary && !summary.can_retake && !notYetOpen && !isClosed;
  const st = courseStyle(course?.color ?? "indigo");
  // One primary action, derived from attempt state — never "Retake" on a first try.
  const actionLabel = worksheetActionLabel({
    attemptsUsed: used,
    canRetake: summary?.can_retake ?? true,
  });
  return (
    <MotionCard className="flex flex-wrap items-center gap-3 p-4">
      <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold", st.soft)}>
        {course?.code ?? "—"}
      </span>
      <div className="min-w-0 flex-1">
        <p data-testid="student-worksheet-title" className="truncate text-sm font-semibold">
          {quiz.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {quiz.duration_minutes} min
          {quiz.allow_retake
            ? quiz.max_attempts === 0
              ? " · Retakes allowed (unlimited)"
              : ` · Retakes allowed (up to ${quiz.max_attempts})`
            : " · Single attempt"}
          {started ? ` · ${used} attempt${used === 1 ? "" : "s"} used` : ""}
        </p>
        <MaterialChips attachments={quiz.attachments} />
      </div>
      {summary && summary.effective_score != null && summary.effective_total != null ? (
        <Badge tone="green">
          Score: {summary.effective_score}/{summary.effective_total}
        </Badge>
      ) : started ? (
        <Badge tone="slate">Submitted</Badge>
      ) : (
        <Badge tone="slate">Not started</Badge>
      )}
      {canRequestRetake ? (
        <button
          type="button"
          disabled={requestingRetake || summary?.retake_request_status === "pending"}
          onClick={async () => {
            setRequestingRetake(true);
            try {
              await requestWorksheetRetake(quiz.id);
              await queryClient.invalidateQueries({ queryKey: ["quiz-summaries"] });
              toast.success("Retake request sent to your teacher.");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not request a retake.");
            } finally {
              setRequestingRetake(false);
            }
          }}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {requestingRetake
            ? "Sending…"
            : summary?.retake_request_status === "pending"
              ? "Request pending"
              : "Request retake"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!canTake}
          title={
            notYetOpen
              ? "This worksheet is not open yet."
              : isClosed
                ? "The submission deadline has passed."
                : !canTake
                  ? "No attempts remaining. Contact your teacher to request a retake."
                  : undefined
          }
          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {notYetOpen ? "Opens soon" : isClosed ? "Submission closed" : actionLabel} →
        </button>
      )}
      <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-slate-950/50" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-xl">
            <AlertDialog.Title className="text-lg font-bold">Start {quiz.title}?</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Your timer will begin immediately. Make sure you are ready before starting.
            </AlertDialog.Description>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <AlertDialog.Cancel className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted">
                Cancel
              </AlertDialog.Cancel>
              <AlertDialog.Action
                onClick={() => {
                  examLock.lock();
                  setTaking(true);
                }}
                className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Start worksheet
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      {taking &&
        createPortal(
          <Suspense
            fallback={
              <Modal open title={quiz.title} onClose={() => setTaking(false)}>
                <LoadingSkeleton />
              </Modal>
            }
          >
            <WorksheetSession quiz={quiz} onClose={() => setTaking(false)} />
          </Suspense>,
          document.body,
        )}
    </MotionCard>
  );
}

function StudentAssignmentRow({
  assignment,
  course,
  submission,
}: {
  assignment: Assignment;
  course?: Course | undefined;
  submission?: Submission | undefined;
}) {
  const st = courseStyle(course?.color ?? "indigo");
  const due = daysUntil(assignment.due_date);
  const status = !submission || submission.status === "pending" ? "pending" : submission.status;
  const actionLabel = assignmentActionLabel({ status });
  return (
    <MotionCard className="flex flex-wrap items-center gap-3 p-4">
      <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold", st.soft)}>
        {course?.code ?? "—"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{assignment.title}</p>
        <p className="text-xs text-muted-foreground">
          {COMPONENT_LABELS[assignment.component_type]} · {assignment.total_points} pts
          {assignment.due_date ? ` · due ${fmtDate(assignment.due_date)}` : ""}
        </p>
        <MaterialChips attachments={assignment.attachments} />
      </div>
      {status === "graded" && submission?.score != null ? (
        <Badge tone="green">
          {submission.score}/{assignment.total_points}
        </Badge>
      ) : status === "submitted" ? (
        <Badge tone="amber">Submitted</Badge>
      ) : (
        <Badge
          tone={
            due === "Overdue"
              ? "red"
              : due.includes("today") || due.includes("tomorrow")
                ? "amber"
                : "slate"
          }
        >
          {due}
        </Badge>
      )}
      <Link
        to="/dashboard/student/assignments"
        className="flex h-9 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15"
      >
        {actionLabel} →
      </Link>
    </MotionCard>
  );
}
