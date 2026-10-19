/* eslint-disable @typescript-eslint/no-explicit-any */
// Courses, assignments, enrollments, submissions.
import { z } from "zod";
import { db } from "@/integrations/db/client.server";
import { unwrap, withoutToken, isUniqueViolation } from "@/lib/server/utils.server";
import {
  requireStaff,
  requireSelfOrStaff,
  requireEnrollment,
  enrolledCourseIds,
} from "@/lib/server/auth.server";
import { requireOpen, canViewAssessment } from "@/lib/server/availability";
import { schemas } from "@/lib/server/schemas.server";
import { createProfile, getProfileById, updateProfile } from "@/lib/server/profiles.server";
import { addMeetingMembers } from "@/lib/server/meetings.server";
import { type ProfileRole } from "@/lib/server/db-types";
import { ENROLLMENT_ERRORS, type BulkAddResult, type BulkAddRowOutcome } from "@/lib/enrollment";
import { dispatchNotification } from "@/lib/server/notifications.server";

/**
 * Pure course-visibility rule (unit-tested): staff (teacher/admin) can see any
 * course; a student can only see a course they are enrolled in. Mirrors the
 * course-content gate in `auth.server requireEnrollment`.
 */
export function hasCourseAccess(role: ProfileRole, enrolled: boolean): boolean {
  return role !== "student" || enrolled;
}

/**
 * Pure catalog filter (unit-tested): apply {@link hasCourseAccess} over the
 * full course list against the caller's enrollment set. Students get only the
 * courses they are enrolled in; staff get the full catalog.
 */
export function filterCoursesForCaller<T extends { id: string }>(
  courses: T[],
  enrolledIds: readonly string[],
  role: ProfileRole,
): T[] {
  const enrolled = new Set(enrolledIds);
  return courses.filter((c) => hasCourseAccess(role, enrolled.has(c.id)));
}

/**
 * Course catalog. Caller-aware: students only ever receive the courses they
 * are enrolled in (server-side gate — client filters are display-only);
 * staff (teacher/admin) keep the full catalog many staff pages depend on.
 */
export async function listCourses(caller: { id: string; role: ProfileRole }) {
  const courses = await unwrap<any[]>(db.from("courses").select("*").order("code"));
  const enrolledIds = caller.role === "student" ? await enrolledCourseIds(caller.id) : [];
  const visible = filterCoursesForCaller(courses, enrolledIds, caller.role);
  const teachers = await unwrap<Array<{ id: string; full_name: string }>>(
    db
      .from("profiles")
      .select("id, full_name")
      .in("role", ["teacher", "admin"])
      .is("deleted_at", null),
  );
  const byId = new Map(teachers.map((t) => [t.id, t.full_name]));
  return visible.map((c) => ({
    ...c,
    teacher_name: c.teacher_id ? byId.get(c.teacher_id) : undefined,
  }));
}

async function assertTeacherAssignable(teacherId: unknown) {
  if (teacherId == null) return;
  const t = await unwrap<any>(
    db.from("profiles").select("id, role").eq("id", teacherId).is("deleted_at", null).maybeSingle(),
  );
  if (!t || t.role !== "teacher") {
    throw new Error("Course leads must be users with the teacher role");
  }
}

export async function createCourse(input: z.infer<typeof schemas.courseInput>) {
  await assertTeacherAssignable(input["teacher_id"]);
  await unwrap(db.from("courses").insert(withoutToken(input)));
}

export async function authorizeCourseUpdate(
  token: string,
  id: string,
  patch: Record<string, unknown>,
) {
  const caller = await requireStaff(token);
  if (caller.role === "admin") return patch;

  const course = await unwrap<any>(
    db.from("courses").select("teacher_id").eq("id", id).maybeSingle(),
  );
  if (!course || course.teacher_id !== caller.id) {
    throw new Error("Forbidden: you can only edit courses you lead.");
  }
  const { teacher_id: _ignored, ...rest } = patch;
  return rest;
}

const ALLOWED_COURSE_COLUMNS = new Set([
  "title",
  "code",
  "teacher_id",
  "grade_level",
  "color",
  "education_level",
  "college_year",
  "strand",
  "program",
  "grading_system",
  "days_of_week",
  "start_time",
  "end_time",
  "late_threshold_minutes",
  "deleted_at",
]);

export async function updateCourse(id: string, patch: Record<string, unknown>) {
  const safePatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => ALLOWED_COURSE_COLUMNS.has(key)),
  );
  if ("teacher_id" in safePatch) await assertTeacherAssignable(safePatch["teacher_id"]);
  if (Object.keys(safePatch).length)
    await unwrap(db.from("courses").update(safePatch).eq("id", id));
}

export async function deleteCourse(id: string) {
  await unwrap(db.from("courses").delete().eq("id", id));
}

export async function listAssignments(caller: { id: string; role: ProfileRole }) {
  const rows = await unwrap<any[]>(
    db.from("assignments").select("*").is("deleted_at", null).order("due_date"),
  );
  // Staff (teacher/admin) see every course's rows; students only see items in
  // courses they are enrolled in AND that have opened (closed items stay
  // visible for review).
  if (caller.role !== "student") return rows;
  const enrolled = new Set(await enrolledCourseIds(caller.id));
  const now = new Date();
  return rows.filter((a) => enrolled.has(a.course_id) && canViewAssessment(a, caller.role, now));
}

export async function createAssignment(input: z.infer<typeof schemas.assignmentInput>) {
  await unwrap(db.from("assignments").insert(withoutToken(input)));

  // Notify enrolled students via email and SMS
  void dispatchNotification({
    type: "assignment",
    title: (input as any).title ?? "New Assignment",
    body: (input as any).description
      ? (input as any).description.slice(0, 150)
      : "A new assignment has been posted.",
    course_id: (input as any).course_id,
  }).catch((err) => {
    console.error("[assignments] Failed to dispatch notifications:", err);
  });
}

export async function enrollmentsForCourse(courseId: string): Promise<string[]> {
  const rows = await unwrap<Array<{ student_id: string }>>(
    db.from("enrollments").select("student_id").eq("course_id", courseId),
  );
  return rows.map((r) => r.student_id);
}

export async function enrollmentsForStudent(studentId: string): Promise<string[]> {
  const rows = await unwrap<Array<{ course_id: string }>>(
    db.from("enrollments").select("course_id").eq("student_id", studentId),
  );
  return rows.map((r) => r.course_id);
}

export async function enrollStudent(student_id: string, course_id: string) {
  const existing = await unwrap<{ id: string } | null>(
    db
      .from("enrollments")
      .select("id")
      .eq("student_id", student_id)
      .eq("course_id", course_id)
      .maybeSingle(),
  );
  if (!existing) await unwrap(db.from("enrollments").insert({ student_id, course_id }));
}

/**
 * Enroll many students into one course with two queries instead of 2N:
 * one SELECT for the already-enrolled ids and one INSERT for the missing ones.
 * Idempotent — re-enrolling an existing student is a no-op.
 */
export async function enrollStudents(studentIds: string[], course_id: string) {
  const ids = [...new Set(studentIds)].filter((id) => typeof id === "string" && id.length > 0);
  if (!ids.length) return { enrolled: 0 };
  const existing = await unwrap<Array<{ student_id: string }>>(
    db.from("enrollments").select("student_id").eq("course_id", course_id).in("student_id", ids),
  );
  const have = new Set(existing.map((r) => r.student_id));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length) {
    await unwrap(
      db.from("enrollments").insert(missing.map((student_id) => ({ student_id, course_id }))),
    );
  }
  return { enrolled: missing.length };
}

/**
 * Create a new student OR reuse an existing one, then (optionally) enroll them
 * into a course — all in one call. Identity is matched on `student_id` first,
 * then `email`, so re-submitting a student that already exists links them to the
 * target course instead of failing with a duplicate-identity error.
 *
 * Authorization mirrors `authorizeProfileUpdate`: only admins may change login
 * credentials (PIN/RFID/email) or edit non-student accounts; teachers may refresh
 * the non-credential roster fields (name/grade/section) of student records.
 * `caller` is resolved server-side from the session token (never client-supplied).
 *
 * Returns `{ profile, created, enrolled }` so callers can show the right toast.
 */
export async function createOrEnrollStudent(
  input: z.infer<typeof schemas.studentEnroll>,
  caller: { id: string; role: ProfileRole },
) {
  const { course_id, ...rest } = input;
  const fields = withoutToken(rest) as Record<string, unknown>;
  const isAdmin = caller.role === "admin";
  const studentId = typeof fields["student_id"] === "string" ? fields["student_id"].trim() : null;
  const email =
    typeof fields["email"] === "string" && fields["email"].trim()
      ? fields["email"].trim().toLowerCase()
      : null;

  // Resolve an existing student by student number, then by email.
  let existingId: string | null = null;
  if (studentId) {
    const row = await unwrap<{ id: string } | null>(
      db
        .from("profiles")
        .select("id")
        .eq("student_id", studentId)
        .is("deleted_at", null)
        .maybeSingle(),
    );
    if (row) existingId = row.id;
  }
  if (!existingId && email) {
    const row = await unwrap<{ id: string } | null>(
      db.from("profiles").select("id").ilike("email", email).is("deleted_at", null).maybeSingle(),
    );
    if (row) existingId = row.id;
  }

  let profile;
  let created: boolean;
  if (existingId) {
    const existing = await getProfileById(existingId);
    if (!existing) throw new Error(ENROLLMENT_ERRORS.notFound);
    // The roster form is for students only — never silently rewrite a staff
    // account that happens to share an identity.
    if (existing.role !== "student") {
      throw new Error(ENROLLMENT_ERRORS.nonStudent(existing.role));
    }
    // Reuse the record: refresh the editable roster fields, but never rewrite
    // the identity columns that were used to find them.
    const patch: Record<string, unknown> = {};
    if (fields["full_name"]) patch["full_name"] = fields["full_name"];
    if (fields["grade_level"] != null) patch["grade_level"] = fields["grade_level"];
    if (fields["section"] != null) patch["section"] = fields["section"];
    // Credentials and email are admin-only (same rule as updateProfile).
    if (isAdmin) {
      if (email) patch["email"] = email;
      if (fields["pin"]) patch["pin"] = fields["pin"];
      if (fields["rfid_uid"]) patch["rfid_uid"] = fields["rfid_uid"];
    }
    // Deliberately do NOT touch avatar_url here: the roster form always sends a
    // generated avatar, and re-enrolling an existing student must not replace
    // the photo they may have uploaded.
    if (Object.keys(patch).length) await updateProfile(existingId, patch);
    const fresh = await getProfileById(existingId);
    if (!fresh) throw new Error("Student not found");
    profile = fresh;
    created = false;
  } else {
    profile = await createProfile(fields as unknown as z.infer<typeof schemas.profileInput>);
    created = true;
  }

  if (course_id) await enrollStudent(profile.id, course_id);
  return { profile, created, enrolled: !!course_id };
}

/**
 * Bulk roster import: create-or-enroll every row of a pasted class list in one
 * call, optionally into a course and one of its meetings (lecture/lab).
 *
 * Reuses {@link createOrEnrollStudent} per row, so identity matching and the
 * student-only safety rules stay identical to the one-by-one form. Each row is
 * independent — one bad row reports a failure without sinking the batch — and
 * meeting membership is APPENDED (never replaced) so a running import cannot
 * clobber memberships another staff member is editing.
 */
export async function bulkAddStudents(
  input: z.infer<typeof schemas.bulkStudentEnroll>,
  caller: { id: string; role: ProfileRole },
): Promise<BulkAddResult> {
  const { students, course_id, meeting_id, token } = input;

  if (meeting_id) {
    if (!course_id) throw new Error("Pick a course before assigning a meeting.");
    const meeting = await unwrap<{ course_id: string } | null>(
      db.from("course_meetings").select("course_id").eq("id", meeting_id).maybeSingle(),
    );
    if (!meeting) throw new Error("Course meeting not found");
    if (meeting.course_id !== course_id) throw new Error("That meeting belongs to another course.");
  }

  const rows: BulkAddRowOutcome[] = [];
  const savedIds: string[] = [];
  for (let index = 0; index < students.length; index++) {
    const row = students[index]!;
    try {
      const { profile, created } = await createOrEnrollStudent(
        { ...row, role: "student", course_id: course_id ?? null, token },
        caller,
      );
      rows.push({
        index,
        full_name: profile.full_name || row.full_name,
        status: created ? "created" : "existing",
        profile_id: profile.id,
      });
      savedIds.push(profile.id);
    } catch (e) {
      rows.push({
        index,
        full_name: row.full_name,
        status: "failed",
        profile_id: null,
        error: e instanceof Error ? e.message : "Could not save student",
      });
    }
  }

  let meeting_added: number | null = null;
  if (meeting_id && savedIds.length) {
    meeting_added = (await addMeetingMembers(meeting_id, savedIds)).added;
  }

  return {
    added: rows.filter((r) => r.status === "created").length,
    linked: rows.filter((r) => r.status === "existing").length,
    enrolled: course_id ? savedIds.length : 0,
    meeting_added,
    rows,
  };
}

export async function listSubmissionsForStudent(studentId: string) {
  return unwrap<any[]>(db.from("submissions").select("*").eq("student_id", studentId));
}

/** All submissions for one assignment joined with student identity — staff view. */
export async function listSubmissionsForAssignment(assignmentId: string, token: string) {
  await requireStaff(token);
  const rows = await unwrap<any[]>(
    db
      .from("submissions")
      // Explicit columns — never expose future/internal columns via SELECT *.
      .select(
        "id, assignment_id, student_id, content, file_urls, score, feedback, status, submitted_at",
      )
      .eq("assignment_id", assignmentId),
  );
  if (!rows.length) return [];
  const studentIds = [...new Set(rows.map((r) => r.student_id as string))];
  const profiles = await unwrap<any[]>(
    db.from("profiles").select("id, full_name, student_id, section").in("id", studentIds),
  );
  const byId = new Map(profiles.map((p) => [p.id as string, p]));
  return rows.map((r) => {
    const p = byId.get(r.student_id as string);
    return {
      id: r.id,
      student_id: r.student_id,
      full_name: p?.full_name ?? "Unknown student",
      student_no: p?.student_id ?? null,
      section: p?.section ?? null,
      content: r.content ?? null,
      file_urls: Array.isArray(r.file_urls) ? r.file_urls : [],
      score: r.score ?? null,
      feedback: r.feedback ?? null,
      status: r.status,
      submitted_at: r.submitted_at ?? null,
    };
  });
}

/** Teacher manually grades a submission (score/feedback/status). */
export async function gradeSubmission(
  token: string,
  submissionId: string,
  patch: {
    score: number | null;
    feedback: string | null;
    status?: "pending" | "submitted" | "graded" | undefined;
  },
) {
  const submission = await unwrap<any>(
    db.from("submissions").select("id, assignment_id, status").eq("id", submissionId).maybeSingle(),
  );
  if (!submission) throw new Error("Submission not found");
  // Reuse the assignment-ownership guard so teachers only grade their own courses.
  const { requireAssignmentOwnerOrAdmin } = await import("@/lib/server/materials.server");
  await requireAssignmentOwnerOrAdmin(token, submission.assignment_id as string);
  const row: Record<string, unknown> = {
    score: patch.score,
    feedback: patch.feedback,
  };
  // Status: an explicit status wins; otherwise setting a score marks it graded,
  // while clearing the score (score == null) PRESERVES the existing status so a
  // previously graded submission is never silently downgraded to "submitted".
  if (patch.status) row["status"] = patch.status;
  else if (patch.score != null) row["status"] = "graded";
  await unwrap(db.from("submissions").update(row).eq("id", submissionId));
}

export async function submitAssignment(input: z.infer<typeof schemas.submissionInput>) {
  // Hard-block (user policy 2026-10-06): students must be enrolled in the
  // assignment's course and can only submit inside its availability window
  // (opens_at .. earliest of closes_at/due_date). Rejected before opens_at and
  // after the deadline — no late flag, no overwrite. Staff bypass for
  // grading/preview.
  const caller = await requireSelfOrStaff(input.token, input.student_id);
  const assignment = await unwrap<{
    id: string;
    course_id: string;
    opens_at: string | null;
    closes_at: string | null;
    due_date: string | null;
  } | null>(
    db
      .from("assignments")
      .select("id, course_id, opens_at, closes_at, due_date")
      .eq("id", input.assignment_id)
      .maybeSingle(),
  );
  if (!assignment) throw new Error("Assignment not found");
  if (caller.role === "student") {
    await requireEnrollment(assignment.course_id, caller);
    requireOpen(assignment, new Date());
  }
  const existing = await unwrap<{ id: string } | null>(
    db
      .from("submissions")
      .select("id")
      .eq("assignment_id", input.assignment_id)
      .eq("student_id", input.student_id)
      .maybeSingle(),
  );
  const row: Record<string, unknown> = { ...withoutToken(input) };
  // Spoof-proof submission metadata (audit m1): `submitted_at` is server-set on
  // every write and `status` is not student-writable — a student's write always
  // records a plain "submitted" state. Staff may still set `status` explicitly.
  row["submitted_at"] = new Date().toISOString();
  if (caller.role === "student") {
    row["status"] = "submitted";
  } else if (row["status"] === undefined) {
    delete row["status"];
  }
  if (existing) {
    await unwrap(db.from("submissions").update(row).eq("id", existing.id));
    return { id: existing.id };
  }
  const created = await unwrap<{ id: string }>(
    db.from("submissions").insert(row).select("id").single(),
  ).catch(async (e: unknown) => {
    // A concurrent first submit can race the read above; the unique
    // (assignment_id, student_id) constraint fires 23505. Re-read and reuse it.
    if (isUniqueViolation(e)) {
      const again = await unwrap<{ id: string } | null>(
        db
          .from("submissions")
          .select("id")
          .eq("assignment_id", input.assignment_id)
          .eq("student_id", input.student_id)
          .maybeSingle(),
      );
      if (again) return again;
    }
    throw e;
  });
  return { id: created.id };
}

export async function requireCourseOwnerOrAdmin(token: string, courseId: string) {
  const caller = await requireStaff(token);
  if (caller.role === "teacher") {
    const course = await unwrap<any>(
      db.from("courses").select("teacher_id").eq("id", courseId).maybeSingle(),
    );
    if (!course || course.teacher_id !== caller.id) {
      throw new Error("Forbidden: you can only manage content for your own courses.");
    }
  }
  return caller;
}
