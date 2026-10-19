export interface PendingTaskCounts {
  activities: number;
  worksheets: number;
  grading: number;
  scoreReleases: number;
}

export function countStudentTasks(
  activities: readonly { id: string }[],
  worksheets: readonly { id: string }[],
  submissions: readonly { assignment_id: string; status: string }[],
  attempts: readonly { quiz_id: string }[],
): PendingTaskCounts {
  const submitted = new Set(
    submissions
      .filter((s) => s.status === "submitted" || s.status === "graded")
      .map((s) => s.assignment_id),
  );
  const attempted = new Set(attempts.map((a) => a.quiz_id));
  return {
    activities: activities.filter((a) => !submitted.has(a.id)).length,
    worksheets: worksheets.filter((q) => !attempted.has(q.id)).length,
    grading: 0,
    scoreReleases: 0,
  };
}

export function countStaffTasks(
  submissions: readonly { status: string }[],
  worksheets: readonly { id: string; score_released?: boolean | null }[],
  attempts: readonly { quiz_id: string }[],
): PendingTaskCounts {
  const attempted = new Set(attempts.map((a) => a.quiz_id));
  return {
    activities: 0,
    worksheets: 0,
    grading: submissions.filter((s) => s.status === "submitted").length,
    scoreReleases: worksheets.filter((q) => q.score_released !== true && attempted.has(q.id))
      .length,
  };
}

export function taskCountForPath(path: string, role: string, counts?: PendingTaskCounts): number {
  if (!counts) return 0;
  if (role === "student") {
    if (path.endsWith("/assignments")) return counts.activities;
    if (path.endsWith("/courses")) return counts.activities + counts.worksheets;
  } else {
    if (path.endsWith("/courses")) return counts.grading + counts.scoreReleases;
    if (path.endsWith("/grades")) return counts.grading;
  }
  return 0;
}

export const TASKS_CHANGED_EVENT = "miow:tasks-changed";
export function notifyTasksChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
}
