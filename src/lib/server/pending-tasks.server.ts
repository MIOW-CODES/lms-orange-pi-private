import { db } from "@/integrations/db/client.server";
import { enrolledCourseIds } from "./auth.server";
import { hasOpened } from "./availability";
import { unwrap } from "./utils.server";
import type { ProfileRole } from "./db-types";
import { countStudentTasks, countStaffTasks, type PendingTaskCounts } from "@/lib/pending-tasks";

/** Only counts leave the server. Never send other students' submissions to navigation. */
export async function pendingTasks(caller: {
  id: string;
  role: ProfileRole;
}): Promise<PendingTaskCounts> {
  const courseIds =
    caller.role === "student"
      ? await enrolledCourseIds(caller.id)
      : (
          await unwrap<Array<{ id: string }>>(
            caller.role === "teacher"
              ? db.from("courses").select("id").eq("teacher_id", caller.id)
              : db.from("courses").select("id"),
          )
        ).map((c) => c.id);
  const empty = { activities: 0, worksheets: 0, grading: 0, scoreReleases: 0 };
  if (!courseIds.length) return empty;
  const [activities, worksheets] = await Promise.all([
    unwrap<Array<{ id: string; opens_at: string | null }>>(
      db
        .from("assignments")
        .select("id, opens_at")
        .in("course_id", courseIds)
        .is("deleted_at", null),
    ),
    unwrap<Array<{ id: string; opens_at: string | null; score_released: boolean | null }>>(
      db
        .from("quizzes")
        .select("id, opens_at, score_released")
        .in("course_id", courseIds)
        .is("deleted_at", null),
    ),
  ]);
  const student = caller.role === "student";
  const now = new Date();
  const visibleActivities = student ? activities.filter((a) => hasOpened(a, now)) : activities;
  const visibleWorksheets = student ? worksheets.filter((q) => hasOpened(q, now)) : worksheets;
  const activityIds = visibleActivities.map((a) => a.id);
  const quizIds = visibleWorksheets.map((q) => q.id);
  const [submissions, attempts] = await Promise.all([
    activityIds.length
      ? unwrap<Array<{ assignment_id: string; status: string }>>(
          student
            ? db
                .from("submissions")
                .select("assignment_id, status")
                .in("assignment_id", activityIds)
                .eq("student_id", caller.id)
            : db
                .from("submissions")
                .select("assignment_id, status")
                .in("assignment_id", activityIds)
                .eq("status", "submitted"),
        )
      : [],
    quizIds.length
      ? unwrap<Array<{ quiz_id: string }>>(
          student
            ? db
                .from("quiz_attempts")
                .select("quiz_id")
                .in("quiz_id", quizIds)
                .eq("student_id", caller.id)
            : db.from("quiz_attempts").select("quiz_id").in("quiz_id", quizIds),
        )
      : [],
  ]);
  return student
    ? countStudentTasks(visibleActivities, visibleWorksheets, submissions, attempts)
    : countStaffTasks(submissions, visibleWorksheets, attempts);
}
