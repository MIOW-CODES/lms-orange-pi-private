import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ClipboardList, FileQuestion, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  deleteAssignment,
  deleteCourse,
  deleteQuiz,
  listAssignments,
  listCourses,
  listQuizzes,
  listTeachers,
  updateQuizRetakePolicy,
  type Assignment,
  type Course,
  type Quiz,
} from "@/lib/lms";
import { staffNav, AppShell, EmptyState, Modal, useProfile } from "@/components/lms";
import { EMPTY_POLICY, policyPayload } from "@/components/courses/constants";
import { PolicyFields } from "@/components/courses/policy-fields";
import { AttemptRoster } from "@/components/courses/attempt-roster";
import { SubmissionInspector } from "@/components/courses/submission-inspector";
import { CourseCardGrid } from "@/components/courses/course-card-grid";
import { StaffCourseWorkspace } from "@/components/courses/course-workspace";
import { useCourseSelection } from "@/hooks/useCourseWorkspace";
import { CourseWizardModal } from "@/components/courses/course-wizard-modal";
import { CreateAssignmentModal } from "@/components/courses/create-assignment-modal";
import { CreateQuizModal } from "@/components/courses/create-quiz-modal";
import { EditQuizModal } from "@/components/courses/edit-quiz-modal";
import { EditAssignmentModal } from "@/components/courses/edit-assignment-modal";
import { ConfirmRemoveModal } from "@/components/courses/confirm-remove-modal";
import { LoadingSkeleton } from "@/components/ui-elements";

export const Route = createFileRoute("/dashboard/admin/courses")({
  head: () => ({
    meta: [
      { title: "Courses | MIOW - Integrated Developmental School" },
      { name: "description", content: "Manage courses, assignments and worksheets." },
      { property: "og:title", content: "Courses | MIOW - Integrated Developmental School" },
      { property: "og:description", content: "Manage courses, assignments and worksheets." },
    ],
  }),
  component: CoursesPage,
});

export function CoursesPage() {
  const profile = useProfile(["admin", "teacher"]);
  const qc = useQueryClient();
  const { data: courses } = useQuery({
    queryKey: ["courses"],
    queryFn: listCourses,
    enabled: !!profile,
  });
  const { data: teachers } = useQuery({
    queryKey: ["teachers"],
    queryFn: listTeachers,
    enabled: !!profile,
  });
  const { data: quizzes } = useQuery({
    queryKey: ["quizzes"],
    queryFn: listQuizzes,
    enabled: !!profile,
  });
  const { data: assignments } = useQuery({
    queryKey: ["assignments"],
    queryFn: listAssignments,
    enabled: !!profile,
  });

  const [modal, setModal] = useState<"course" | "assignment" | "quiz" | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [policyQuiz, setPolicyQuiz] = useState<Quiz | null>(null);
  const [policyForm, setPolicyForm] = useState(EMPTY_POLICY);
  const [rosterQuiz, setRosterQuiz] = useState<Quiz | null>(null);
  const [submissionsAssignment, setSubmissionsAssignment] = useState<Assignment | null>(null);
  const [editQuiz, setEditQuiz] = useState<Quiz | null>(null);
  const [editAssign, setEditAssign] = useState<Assignment | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{
    kind: "quiz" | "assignment";
    id: string;
    title: string;
  } | null>(null);
  const [removeCourseTarget, setRemoveCourseTarget] = useState<Course | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedCourseId, selectCourse] = useCourseSelection();

  if (!profile) return null;
  const isAdmin = profile.role === "admin";
  const selectedCourse = (courses ?? []).find((c) => c.id === selectedCourseId) ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["courses"] });
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["courses"] });
    qc.invalidateQueries({ queryKey: ["quizzes"] });
    qc.invalidateQueries({ queryKey: ["assignments"] });
  };

  const openEdit = (c: Course) => {
    setEditingCourse(c);
    setModal("course");
  };

  const confirmRemoveCourse = async () => {
    if (!removeCourseTarget) return;
    setSaving(true);
    try {
      await deleteCourse(removeCourseTarget.id);
      toast.success("Course deleted.");
      setRemoveCourseTarget(null);
      refresh();
    } catch {
      toast.error("Couldn't delete the course — try again.");
    } finally {
      setSaving(false);
    }
  };

  const openPolicy = (q: Quiz) => {
    setPolicyForm({
      allow_retake: q.allow_retake,
      unlimited: q.max_attempts === 0,
      max_attempts: String(q.max_attempts || 1),
      retake_score_policy: q.retake_score_policy,
    });
    setPolicyQuiz(q);
  };

  const savePolicy = async () => {
    if (!policyQuiz) return;
    setSaving(true);
    try {
      await updateQuizRetakePolicy(policyQuiz.id, policyPayload(policyForm));
      toast.success("Retake policy updated.");
      setPolicyQuiz(null);
      qc.invalidateQueries({ queryKey: ["quizzes"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the retake policy.");
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async (mode: "soft" | "hard") => {
    if (!removeTarget) return;
    setSaving(true);
    try {
      if (removeTarget.kind === "quiz") await deleteQuiz(removeTarget.id, mode);
      else await deleteAssignment(removeTarget.id, mode);
      toast.success(mode === "soft" ? "Archived — student records kept." : "Permanently deleted.");
      setRemoveTarget(null);
      qc.invalidateQueries({ queryKey: ["quizzes"] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove this item.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      nav={staffNav(profile.role)}
      profile={profile}
      subtitle={profile.role === "admin" ? "MIOW Admin Console" : "MIOW Teacher Portal"}
    >
      {selectedCourse ? (
        <StaffCourseWorkspace
          course={selectedCourse}
          quizzes={quizzes ?? []}
          assignments={assignments ?? []}
          loading={quizzes === undefined || assignments === undefined}
          onBack={() => selectCourse(null)}
          onNewQuiz={() => setModal("quiz")}
          onNewAssignment={() => setModal("assignment")}
          onPolicy={openPolicy}
          onEditQuiz={setEditQuiz}
          onRemoveQuiz={(q) => setRemoveTarget({ kind: "quiz", id: q.id, title: q.title })}
          onRoster={setRosterQuiz}
          onEditAssignment={setEditAssign}
          onRemoveAssignment={(a) =>
            setRemoveTarget({ kind: "assignment", id: a.id, title: a.title })
          }
          onSubmissions={setSubmissionsAssignment}
        />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold sm:text-3xl">Courses</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {courses === undefined ? (
                  <span className="inline-block h-4 w-28 animate-pulse rounded bg-muted align-middle" />
                ) : (
                  `${courses.length} active courses`
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setEditingCourse(null);
                  setModal("course");
                }}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                <BookOpen className="h-4 w-4" /> Course
              </button>
              <button
                onClick={() => setModal("assignment")}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted"
              >
                <ClipboardList className="h-4 w-4" /> Assignment
              </button>
              <button
                onClick={() => setModal("quiz")}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted"
              >
                <FileQuestion className="h-4 w-4" /> Worksheet
              </button>
            </div>
          </div>

          {courses === undefined ? (
            <LoadingSkeleton />
          ) : courses.length === 0 ? (
            <EmptyState
              title="No courses yet"
              sub={
                isAdmin
                  ? "Create your first course to begin."
                  : "An administrator will assign courses to you."
              }
            />
          ) : (
            <>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Select a course to open its worksheets, assignments and class record
              </p>
              <CourseCardGrid
                courses={courses ?? []}
                profile={profile}
                isAdmin={isAdmin}
                onOpen={(c) => selectCourse(c.id)}
                onEdit={openEdit}
                onRemove={setRemoveCourseTarget}
              />
            </>
          )}
        </>
      )}

      <CourseWizardModal
        open={modal === "course"}
        onClose={() => {
          setModal(null);
          setEditingCourse(null);
        }}
        editing={editingCourse}
        teachers={teachers ?? []}
        isAdmin={isAdmin}
        currentUserId={profile.id}
        onSaved={invalidateAll}
      />

      <CreateAssignmentModal
        open={modal === "assignment"}
        onClose={() => setModal(null)}
        courses={courses ?? []}
        {...(selectedCourse ? { defaultCourseId: selectedCourse.id } : {})}
        onSaved={invalidateAll}
      />

      <CreateQuizModal
        open={modal === "quiz"}
        onClose={() => setModal(null)}
        courses={courses ?? []}
        {...(selectedCourse ? { defaultCourseId: selectedCourse.id } : {})}
        onSaved={invalidateAll}
      />

      <Modal
        open={!!policyQuiz}
        onClose={() => setPolicyQuiz(null)}
        title={`Retake policy — ${policyQuiz?.title ?? ""}`}
      >
        <PolicyFields
          value={policyForm}
          onChange={(patch) => setPolicyForm((f) => ({ ...f, ...patch }))}
        />
        <button
          onClick={savePolicy}
          disabled={saving}
          className="mt-4 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save policy"}
        </button>
      </Modal>

      <EditQuizModal quiz={editQuiz} onClose={() => setEditQuiz(null)} onSaved={invalidateAll} />

      <EditAssignmentModal
        assignment={editAssign}
        onClose={() => setEditAssign(null)}
        onSaved={invalidateAll}
      />

      <ConfirmRemoveModal
        target={removeTarget}
        saving={saving}
        onConfirm={confirmRemove}
        onClose={() => setRemoveTarget(null)}
      />

      {/* Course deletion confirmation — one click used to erase a whole course. */}
      <Modal
        open={!!removeCourseTarget}
        onClose={() => setRemoveCourseTarget(null)}
        title="Delete course"
      >
        <div className="flex gap-3 rounded-xl border border-rose-300/60 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <span className="font-semibold">
              {removeCourseTarget ? `${removeCourseTarget.code} — ${removeCourseTarget.title}` : ""}
            </span>{" "}
            — deleting a course removes it and everything inside it: worksheets, assignments,
            enrollments, schedules and grades. This cannot be undone.
          </p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          This is permanent — only delete a course that was created by mistake.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setRemoveCourseTarget(null)}
            className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={confirmRemoveCourse}
            disabled={saving}
            className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Deleting…" : "Delete course"}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!rosterQuiz}
        onClose={() => setRosterQuiz(null)}
        title={`Attempts — ${rosterQuiz?.title ?? ""}`}
        wide
      >
        {rosterQuiz && <AttemptRoster quizId={rosterQuiz.id} />}
      </Modal>

      <Modal
        open={!!submissionsAssignment}
        onClose={() => setSubmissionsAssignment(null)}
        title={`Submissions — ${submissionsAssignment?.title ?? ""}`}
        wide
      >
        {submissionsAssignment && <SubmissionInspector assignmentId={submissionsAssignment.id} />}
      </Modal>
    </AppShell>
  );
}
