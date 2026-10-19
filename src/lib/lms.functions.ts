// Thin RPC wrappers around the server-only LMS data layer.
// Module scope intentionally contains only imports and server-function
// declarations so code splitting never ships runtime helpers to the client.
//
// Access model:
// - Login endpoints (RFID, PIN) are public and issue a signed HttpOnly cookie.
//   They are the sole entry points — there is no demo/quick-login bypass.
// - listAnnouncements stays public for the kiosk sign-in screen ticker; it
//   exposes only non-sensitive, publicly displayed data.
// - Everything else verifies the caller's signed cookie session server-side
//   (legacy tokens are accepted during migration):
//   admin-only for console settings/role management, teacher-only for
//   gradebook editing, staff-only for other management writes, self-or-staff
//   for student-scoped records, any valid session for catalog reads.
import { createServerFn } from "@tanstack/react-start";
import * as server from "./server";
import { changeOwnPin, parseChangeOwnPinInput } from "./server/profiles.server";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { SESSION_COOKIE_NAME, requireSession } from "./server/auth.server";
import { COOKIE_SESSION_MARKER } from "@/lib/session";

const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env["NODE_ENV"] === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge:
    Number(process.env["SESSION_TTL_MS"]) > 0
      ? Math.floor(Number(process.env["SESSION_TTL_MS"]) / 1000)
      : 43_200,
};

/* ---------- Profiles & kiosk auth (public — they issue tokens) ---------- */

export const getProfileByRfidFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.rfid.parse(data))
  .handler(async ({ data }) => {
    const result = await server.findByRfid(data.uid);
    if (!result) return null;
    setCookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions);
    return { profile: result.profile };
  });

// Unified sign-in for ALL roles: one identifier (student ID, email, or
// username) + secret (PIN or password). Public because it ISSUES the token;
// server-side lockout (5 attempts / 15 min) protects every account type.
export const pinLoginFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.pinLogin.parse(data))
  .handler(async ({ data }) => {
    const result = await server.verifyPinLogin(data.login, data.secret);
    if (result.ok) {
      setCookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions);
      return { ok: true as const, profile: result.profile };
    }
    return result;
  });

export const logoutFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    const token =
      data.token === COOKIE_SESSION_MARKER ? getCookie(SESSION_COOKIE_NAME) : data.token;
    let revokeFailed = false;
    if (token) {
      try {
        const profileId = server.verifySessionToken(token);
        const jti = server.sessionJti(token);
        if (!jti) throw new Error("Session has no revocation identifier");
        await server.revokeSessionJti(jti, profileId);
      } catch (error) {
        // Invalid or expired tokens cannot authorize any request; a database
        // failure for a valid token must be surfaced so the user can retry.
        if (!(error instanceof Error) || error.message !== "Unauthorized") {
          console.error("[auth] sign-out could not revoke server session");
          revokeFailed = true;
        }
      }
    }
    deleteCookie(SESSION_COOKIE_NAME, {
      path: "/",
      secure: process.env["NODE_ENV"] === "production",
    });
    if (revokeFailed)
      throw new Error("Sign-out could not be completed on the server. Please retry.");
    return { ok: true as const };
  });

/* ---------- Profile management (staff only) ---------- */

export const createProfileFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.profileInput.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.createProfile(data);
  });

export const updateProfileFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.profilePatch.parse(data))
  .handler(async ({ data }) => {
    // Authorization lives server-side: self-service for the owner, roster
    // maintenance for staff on student records, and admin-only for staff
    // accounts or any credential (PIN/RFID/email) reset on someone else.
    const patch = await server.authorizeProfileUpdate(data.token, data.id, data.patch);
    return server.updateProfile(data.id, patch);
  });

// Self-service PIN change (any valid session, always the caller's OWN
// account): session proof + optional current PIN, new PIN validated against
// the existing PIN format rules, bcrypt-hashed, and the forced-change
// (pin_must_change) gate cleared in the same write. The same 5-per-15-minute
// rate limiting as sign-in applies on the server.
export const changeOwnPinFn = createServerFn({ method: "POST" })
  .validator((data) => parseChangeOwnPinInput(data))
  .handler(async ({ data }) => {
    const token =
      data.token === COOKIE_SESSION_MARKER ? getCookie(SESSION_COOKIE_NAME) : data.token;
    if (!token) throw new Error("Unauthorized");
    return changeOwnPin(token, data.new_pin, data.current_pin ?? null);
  });

// User removal is ADMIN-only (teachers cannot remove accounts) and runs
// as a soft delete with self-deletion and last-admin safeguards.
export const deleteProfileFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.id.parse(data))
  .handler(async ({ data }) => {
    const admin = await server.requireAdmin(data.token);
    const result = await server.deleteUser(admin.id, data.id);
    await server.writeAuditLog(admin, "User removed", `Profile ${data.id}`);
    return result;
  });

// Teacher-only self-service settings mutation. requireTeacher rejects
// students AND admins; the target row is always the caller's own profile.
export const updateTeacherSettingsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.teacherSettings.parse(data))
  .handler(async ({ data }) => {
    const teacher = await server.requireTeacher(data.token);
    return server.updateTeacherSettings(teacher.id, data.patch);
  });

// Avatar upload: any valid session may upload their OWN photo — the server
// resolves the caller from the token and always writes to their profile.
export const uploadAvatarFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.avatarUpload.parse(data))
  .handler(async ({ data }) => server.uploadAvatar(data.token, data.data, data.content_type));

export const listStudentsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.listStudents();
  });

export const listStaffFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.listStaff();
  });

// Teaching roster for course-lead pickers — admins are NOT included.
export const listTeachersFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.listTeachers();
  });

// Faculty directory with assigned-course relations — ADMIN-only console read.
export const listTeacherDirectoryFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    await server.requireAdmin(data.token);
    return server.listTeacherDirectory();
  });

// Faculty account creation — ADMIN-only; role is forced to 'teacher' and the
// initial PIN is hashed server-side before persistence.
export const createTeacherFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.teacherInput.parse(data))
  .handler(async ({ data }) => {
    await server.requireAdmin(data.token);
    return server.createTeacher(data);
  });

// Biometric / RFID enrolment. Admins may enroll anyone; everyone else may
// only enroll their OWN record (target id is checked against the token).
export const enrollBiometricsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.biometrics.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireSession(data.token);
    if (caller.role !== "admin" && caller.id !== data.id) throw new Error("Forbidden");
    const fields: { rfid_uid?: string | null } = {};
    if ("rfid_uid" in data) fields.rfid_uid = data.rfid_uid ?? null;
    return server.enrollBiometrics(data.id, fields);
  });

// Role administration is ADMIN-only (teachers cannot reassign roles).
export const listAllUsersFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    await server.requireAdmin(data.token);
    return server.listAllUsers();
  });

export const updateUserRoleFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.roleUpdate.parse(data))
  .handler(async ({ data }) => {
    const admin = await server.requireAdmin(data.token);
    const result = await server.updateUserRole(admin.id, data.id, data.role);
    await server.writeAuditLog(admin, "Role updated", `User ${data.id} → ${data.role}`);
    return result;
  });

// Claims refresh: returns the caller's LIVE profile (role included) so the
// client session store can be updated after an admin changes their role —
// permissions re-evaluate without requiring a fresh sign-in.
export const refreshSessionFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    const token =
      data.token === COOKIE_SESSION_MARKER ? getCookie(SESSION_COOKIE_NAME) : data.token;
    if (!token) throw new Error("Unauthorized");
    const profile = await server.requireSession(token, { allowTemporaryPin: true });
    // One-time migration for sessions issued before the HttpOnly cookie rollout.
    if (data.token !== COOKIE_SESSION_MARKER)
      setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions);
    return profile;
  });

/* ---------- Announcements ---------- */

// Public: the kiosk sign-in screen shows the announcements ticker.
export const listAnnouncementsFn = createServerFn({ method: "GET" }).handler(async () =>
  server.listAnnouncements(),
);

export const listFeedbackReportsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => server.listFeedbackReports(data.token));

export const createFeedbackReportFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.feedbackReportInput.parse(data))
  .handler(async ({ data }) => server.createFeedbackReport(data.token, data));

export const updateFeedbackReportFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.feedbackReportPatch.parse(data))
  .handler(async ({ data }) => server.updateFeedbackReport(data.token, data.id, data.patch));

export const createAnnouncementFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.announcementInput.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireStaff(data.token);
    const id = await server.createAnnouncement(data);
    await server.writeAuditLog(caller, "Announcement created", data.title ?? "Untitled");
    return id;
  });

export const updateAnnouncementFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.announcementPatch.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireStaff(data.token);
    const result = await server.updateAnnouncement(data.id, data.patch);
    await server.writeAuditLog(
      caller,
      "Announcement updated",
      data.patch.title ?? `Announcement ${data.id}`,
    );
    return result;
  });

export const deleteAnnouncementFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.id.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.deleteAnnouncement(data.id);
  });

export const uploadAnnouncementMaterialFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.announcementMaterialUpload.parse(data))
  .handler(async ({ data }) =>
    server.uploadAnnouncementMaterial(
      data.token,
      data.announcement_id,
      data.name,
      data.data,
      data.content_type,
    ),
  );

export const removeAnnouncementMaterialFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.announcementMaterialRemove.parse(data))
  .handler(async ({ data }) => server.removeAnnouncementAttachment(data.token, data.attachment_id));

export const listAnnouncementAttachmentsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.id.parse(data))
  .handler(async ({ data }) => {
    await server.requireSession(data.token);
    return server.listAnnouncementAttachments(data.id);
  });

/* ---------- Courses, assignments, enrollments ---------- */

export const listCoursesFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireSession(data.token);
    return server.listCourses(caller);
  });

// Course lifecycle: teachers and admins may create courses. Teachers may only
// lead the courses they create; only admins may assign an arbitrary lead.
// Only admins may reassign course leads or delete courses.
export const createCourseFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.courseInput.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireStaff(data.token);
    const input = caller.role === "teacher" ? { ...data, teacher_id: caller.id } : data;
    return server.createCourse(input);
  });

export const updateCourseFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.coursePatch.parse(data))
  .handler(async ({ data }) => {
    const patch = await server.authorizeCourseUpdate(data.token, data.id, data.patch);
    return server.updateCourse(data.id, patch);
  });

export const deleteCourseFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.id.parse(data))
  .handler(async ({ data }) => {
    const admin = await server.requireAdmin(data.token);
    const result = await server.deleteCourse(data.id);
    await server.writeAuditLog(admin, "Course deleted", `Course ${data.id}`);
    return result;
  });

export const listAssignmentsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireSession(data.token);
    return server.listAssignments(caller);
  });

export const createAssignmentFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.assignmentInput.parse(data))
  .handler(async ({ data }) => {
    // Teachers may only post into courses they lead; admins are universal.
    await server.requireCourseOwnerOrAdmin(data.token, data.course_id);
    return server.createAssignment(data);
  });

export const enrollmentsForCourseFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.courseScoped.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.enrollmentsForCourse(data.courseId);
  });

export const enrollmentsForStudentFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.studentScoped.parse(data))
  .handler(async ({ data }) => {
    await server.requireSelfOrStaff(data.token, data.studentId);
    return server.enrollmentsForStudent(data.studentId);
  });

export const enrollStudentFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.enrollment.parse(data))
  .handler(async ({ data }) => {
    // Teachers may only enroll into courses they lead; admins are universal.
    await server.requireCourseOwnerOrAdmin(data.token, data.course_id);
    return server.enrollStudent(data.student_id, data.course_id);
  });

// Batched enrollment (one SELECT + one INSERT server-side) for the roster modal.
export const enrollStudentsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.enrollmentBatch.parse(data))
  .handler(async ({ data }) => {
    await server.requireCourseOwnerOrAdmin(data.token, data.course_id);
    return server.enrollStudents(data.student_ids, data.course_id);
  });

// Create a new student OR reuse an existing one (matched by student number,
// then email) and optionally enroll them into a course — one staff-only call.
export const createOrEnrollStudentFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.studentEnroll.parse(data))
  .handler(async ({ data }) => {
    const caller = data.course_id
      ? await server.requireCourseOwnerOrAdmin(data.token, data.course_id)
      : await server.requireStaff(data.token);
    return server.createOrEnrollStudent(data, caller);
  });

// Bulk roster import (bulk-add): create-or-enroll a whole class list in one
// call, optionally into a course and one of its meetings. Same identity rules
// as createOrEnrollStudent; one bad row fails alone without sinking the batch.
export const bulkAddStudentsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.bulkStudentEnroll.parse(data))
  .handler(async ({ data }) => {
    const caller = data.course_id
      ? await server.requireCourseOwnerOrAdmin(data.token, data.course_id)
      : await server.requireStaff(data.token);
    const result = await server.bulkAddStudents(data, caller);
    await server.writeAuditLog(
      caller,
      "Bulk students added",
      `${result.added} new · ${result.linked} linked` +
        (data.course_id ? ` · ${result.enrolled} enrolled` : ""),
    );
    return result;
  });

/* ---------- Submissions ---------- */

export const listSubmissionsForStudentFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.studentScoped.parse(data))
  .handler(async ({ data }) => {
    await server.requireSelfOrStaff(data.token, data.studentId);
    return server.listSubmissionsForStudent(data.studentId);
  });

export const submitAssignmentFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.submissionInput.parse(data))
  .handler(async ({ data }) => {
    await server.requireSelfOrStaff(data.token, data.student_id);
    return server.submitAssignment(data);
  });

// Student (or staff on their behalf) attaches a file to a submission.
export const uploadSubmissionFileFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.submissionUpload.parse(data))
  .handler(async ({ data }) =>
    server.uploadSubmissionFile(
      data.token,
      data.submission_id,
      data.name,
      data.data,
      data.content_type,
    ),
  );

// Staff view of every submission on one assignment (scores, answers, files).
export const listSubmissionsForAssignmentFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.assignmentScoped.parse(data))
  .handler(async ({ data }) => server.listSubmissionsForAssignment(data.assignmentId, data.token));

// Teacher manual grading of an assignment submission.
export const gradeSubmissionFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.gradeSubmission.parse(data))
  .handler(async ({ data }) => server.gradeSubmission(data.token, data.id, data.patch));

/* ---------- Quizzes ---------- */

export const listQuizzesFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireSession(data.token);
    return server.listQuizzes(caller);
  });

export const getQuizFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.id.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireSession(data.token);
    // Pass the caller id so the question bank can avoid questions this student
    // already saw in prior attempts (fresh items on retakes).
    return server.getQuizPublic(data.id, caller.id);
  });

// Submit a worksheet attempt. The server enforces the worksheet's retake
// policy BEFORE recording: submissions past the attempt ceiling are rejected
// with a typed { ok: false, reason } payload and nothing is written.
export const submitQuizAttemptFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.quizGrade.parse(data))
  .handler(async ({ data }) =>
    server.submitQuizAttempt(
      data.quiz_id,
      data.answers,
      data.token,
      data.question_ids,
      data.tab_switches,
      data.submission_id,
    ),
  );

// Attempt summaries for every worksheet, for the signed-in student.
export const myQuizSummariesFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => server.listMyQuizSummaries(data.token));

export const quizAttemptInfoFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.quizScoped.parse(data))
  .handler(async ({ data }) => server.quizAttemptInfo(data.quiz_id, data.token));

/* ----- Retake policy management (staff; teachers limited to own courses) ----- */

export const updateQuizRetakePolicyFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.quizPolicy.parse(data))
  .handler(async ({ data }) =>
    server.updateQuizRetakePolicy(
      data.id,
      {
        allow_retake: data.allow_retake,
        max_attempts: data.max_attempts,
        retake_score_policy: data.retake_score_policy,
      },
      data.token,
    ),
  );

export const listQuizAttemptsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.quizScoped.parse(data))
  .handler(async ({ data }) => server.listQuizAttemptsForQuiz(data.quiz_id, data.token));

export const grantQuizRetakeFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.retakeGrant.parse(data))
  .handler(async ({ data }) => server.grantQuizRetake(data.quiz_id, data.student_id, data.token));

export const resetQuizAttemptsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.retakeGrant.parse(data))
  .handler(async ({ data }) => server.resetQuizAttempts(data.quiz_id, data.student_id, data.token));

export const requestQuizRetakeFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.retakeRequest.parse(data))
  .handler(async ({ data }) => server.requestQuizRetake(data.quiz_id, data.token));

export const listQuizRetakeRequestsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.quizScoped.parse(data))
  .handler(async ({ data }) => server.listQuizRetakeRequests(data.quiz_id, data.token));

export const reviewQuizRetakeRequestFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.retakeRequestReview.parse(data))
  .handler(async ({ data }) =>
    server.reviewQuizRetakeRequest(data.request_id, data.decision, data.token),
  );

// Teacher override of a student's effective worksheet score (AI may mis-grade).
export const overrideAttemptFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.attemptOverride.parse(data))
  .handler(async ({ data }) =>
    server.overrideQuizAttempt(
      data.quiz_id,
      data.student_id,
      data.score,
      data.total ?? null,
      data.notes ?? null,
      data.token,
    ),
  );

// Per-question attempt detail for one student on one worksheet.
export const listStudentAttemptDetailFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.attemptDetail.parse(data))
  .handler(async ({ data }) =>
    server.listStudentAttemptDetail(data.quiz_id, data.student_id, data.token),
  );

export const createQuizWithQuestionsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.quizBundle.parse(data))
  .handler(async ({ data }) => {
    // Worksheets (answer key included) may only be created in a course the
    // caller leads; admins may create anywhere.
    await server.requireCourseOwnerOrAdmin(data.token, data.quiz.course_id);
    return server.createQuizWithQuestions(data.quiz, data.questions);
  });

/* ---------- Grades ---------- */

export const listGradesForStudentFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.studentScoped.parse(data))
  .handler(async ({ data }) => {
    await server.requireSelfOrStaff(data.token, data.studentId);
    return server.listGradesForStudent(data.studentId);
  });

export const listGradesForCourseFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.courseQuarter.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.listGradesForCourse(data.courseId, data.quarter);
  });

// Gradebook editing is TEACHER-only: admins manage the system, not grades.
export const upsertGradeFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.gradeInput.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireTeacher(data.token);
    const result = await server.upsertGrade(data, caller.id);
    await server.writeAuditLog(
      caller,
      "Grade modified",
      `Student ${data.student_id} · Q${data.quarter}`,
    );
    return result;
  });

/* ---------- Attendance ---------- */

export const listAttendanceFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.studentScoped.parse(data))
  .handler(async ({ data }) => {
    await server.requireSelfOrStaff(data.token, data.studentId);
    return server.listAttendance(data.studentId);
  });

export const listAllAttendanceFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.limit.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.listAllAttendance(data.limit);
  });

export const logAttendanceFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.attendance.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.logAttendance(
      data.student_id,
      data.scan_type,
      data.status,
      data.timestamp,
      data.course_id,
    );
  });

export const bulkLogAttendanceFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.bulkAttendanceLog.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.bulkLogAttendance(data.items);
  });

// Kiosk tap endpoint — the staff-operated gate kiosk submits a card UID plus
// the reader's timestamp; the server toggles in/out and evaluates on-time vs
// late against the tapped person's class schedule for the day.
export const recordTapFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.tap.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.recordTap(data.uid, data.at);
  });

export const updateAttendanceLogFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.attendancePatch.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.updateAttendanceLog(data.id, data.patch);
  });

export const deleteAttendanceLogFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.id.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.deleteAttendanceLog(data.id);
  });

/* ---------- RFID devices (kiosk readers) ---------- */

export const listRfidDevicesFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.listRfidDevices();
  });

export const createRfidDeviceFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.rfidDeviceCreate.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireStaff(data.token);
    const device = await server.createRfidDevice({
      name: data.name,
      location: data.location ?? null,
    });
    await server.writeAuditLog(
      caller,
      "RFID device registered",
      `${data.name}${data.location ? ` · ${data.location}` : ""}`,
    );
    return device;
  });

export const deactivateRfidDeviceFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.id.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireStaff(data.token);
    const device = await server.deactivateRfidDevice(data.id);
    await server.writeAuditLog(caller, "RFID device deactivated", `Device ${data.id}`);
    return device;
  });

/* ---------- App settings (school-wide admin flags) ---------- */

// Read is open to any signed-in session — students need the kiosk lockdown
// flag to self-apply the lockdown on shared devices. Writes are ADMIN-only
// and validated in the app-settings server module.
export const getKioskLockdownFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    await server.requireSession(data.token);
    return server.getKioskLockdown();
  });

export const setKioskLockdownFn = createServerFn({ method: "POST" })
  .validator((data) => server.kioskLockdownInput.parse(data))
  .handler(async ({ data }) => {
    const admin = await server.requireAdmin(data.token);
    const enabled = await server.setKioskLockdown(data.enabled);
    await server.writeAuditLog(
      admin,
      "Kiosk lockdown updated",
      enabled ? "App-wide student lockdown enabled" : "App-wide student lockdown disabled",
    );
    return enabled;
  });

/* ---------- Misc ---------- */

export const countRowsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.countable.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.countRows(data.table);
  });

/* ---------- Course materials, content editing & deletion (staff) ----------
 * Admins have universal rights; teachers are restricted server-side to
 * courses where they are the assigned lead. */

export const uploadCourseMaterialFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.materialUpload.parse(data))
  .handler(async ({ data }) =>
    server.uploadCourseMaterial(
      data.token,
      data.course_id,
      data.name,
      data.data,
      data.content_type,
    ),
  );

export const attachCourseMaterialFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.materialAttach.parse(data))
  .handler(async ({ data }) =>
    server.attachCourseMaterial(data.token, data.target, data.id, data.attachment),
  );

export const removeCourseMaterialFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.materialRemove.parse(data))
  .handler(async ({ data }) =>
    server.removeCourseMaterial(data.token, data.target, data.id, data.path),
  );

export const updateQuizFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.quizUpdate.parse(data))
  .handler(async ({ data }) => server.updateQuiz(data.token, data.id, data.patch, data.questions));

export const deleteQuizFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.contentDelete.parse(data))
  .handler(async ({ data }) => server.deleteQuiz(data.token, data.id, data.mode));

export const updateAssignmentFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.assignmentPatch.parse(data))
  .handler(async ({ data }) => server.updateAssignment(data.token, data.id, data.patch));

export const deleteAssignmentFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.contentDelete.parse(data))
  .handler(async ({ data }) => server.deleteAssignment(data.token, data.id, data.mode));

export const listQuizScoresForCourseFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.courseScoped.parse(data))
  .handler(async ({ data }) => server.listQuizScoresForCourse(data.courseId, data.token));

/* ---------- Course Meetings ---------- */

export const listCourseMeetingsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.courseScoped.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireSession(data.token);
    // Students may only read the timetable of courses they are enrolled in —
    // a guessed courseId must not leak another course's meeting schedule.
    // Staff (teacher/admin) keep unrestricted access (requireEnrollment no-ops).
    await server.requireEnrollment(data.courseId, caller);
    return server.listCourseMeetings(data.courseId);
  });

// Course meetings: teachers lead their own course meetings; admins may manage any.
export const upsertCourseMeetingFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.courseMeeting.parse(data))
  .handler(async ({ data }) => {
    await server.requireCourseOwnerOrAdmin(data.token, data.course_id);
    return server.upsertCourseMeeting(data);
  });

export const deleteCourseMeetingFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.id.parse(data))
  .handler(async ({ data }) => {
    // Resolve the actor first; the inner call enforces ownership (audit only on success).
    const caller = await server.requireStaff(data.token);
    const result = await server.deleteCourseMeeting(data.id, data.token);
    await server.writeAuditLog(caller, "Course meeting deleted", `Meeting ${data.id}`);
    return result;
  });

// Meeting membership: teachers lead their own course meetings; admins may manage any.
export const setMeetingMembersFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.meetingMembers.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireStaff(data.token);
    const result = await server.setMeetingMembers(data.meeting_id, data.student_ids, data.token);
    await server.writeAuditLog(
      caller,
      "Meeting members updated",
      `Meeting ${data.meeting_id} · ${data.student_ids.length} members`,
    );
    return result;
  });

export const listMeetingMembersFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.id.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.listMeetingMembers(data.id);
  });

/* ---------- Sections & Course Sections ---------- */

export const listSectionsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.listSections();
  });

export const createSectionFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.sectionCreate.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireStaff(data.token);
    const section = await server.createSection(data);
    await server.writeAuditLog(caller, "Section created", `${data.name} (${data.education_level})`);
    return section;
  });

export const listCourseSectionsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.courseScoped.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.listCourseSections(data.courseId);
  });

// Course sections: teachers lead their own courses; admins may manage any.
export const setCourseSectionsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.courseSectionsLink.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireCourseOwnerOrAdmin(data.token, data.course_id);
    await server.setCourseSections(data.course_id, data.section_ids);
    await server.writeAuditLog(
      caller,
      "Course sections updated",
      `Course ${data.course_id} · ${data.section_ids.length} sections`,
    );
  });

// Bulk section enrollment: enroll every student of the given sections into the
// course in one call. Same ownership rules as section linking.
export const enrollSectionStudentsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.courseSectionsLink.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireCourseOwnerOrAdmin(data.token, data.course_id);
    const result = await server.enrollSectionStudents(data.course_id, data.section_ids);
    await server.writeAuditLog(
      caller,
      "Bulk section enrollment",
      `Course ${data.course_id} · ${result.enrolled} enrolled of ${result.candidates} candidates`,
    );
    return result;
  });

// Audit trail: staff may read; writes happen inside privileged RPCs above.
export const listAuditLogsFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.listAuditLogs();
  });

/* ---------- TOS (Table of Specifications) ---------- */

export const listCourseTosFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.courseScoped.parse(data))
  .handler(async ({ data }) => {
    await server.requireStaff(data.token);
    return server.listTosForCourse(data.courseId);
  });

// TOS editing: teachers plan their own courses; admins may manage any.
// Staff-only guard + audit live in the server module (it resolves the caller).
export const upsertTosFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.tosUpsert.parse(data))
  .handler(async ({ data }) =>
    server.upsertTos(data.token, {
      id: data.id,
      courseId: data.courseId,
      quarter: data.quarter,
      title: data.title,
      items: data.items,
    }),
  );

export const deleteTosFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.id.parse(data))
  .handler(async ({ data }) => server.deleteTos(data.token, data.id));

/* ---------- Question bank ---------- */

// Includes answer keys — the server module enforces requireStaff.
export const listQuestionBankFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.questionBankList.parse(data))
  .handler(async ({ data }) =>
    server.listQuestionBank(data.token, { courseId: data.courseId ?? null }),
  );

export const updateQuestionFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.questionUpdate.parse(data))
  .handler(async ({ data }) => server.updateQuestion(data.token, data.id, data.patch));

export const pendingTasksFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.session.parse(data))
  .handler(async ({ data }) => {
    const caller = await server.requireSession(data.token);
    const { pendingTasks } = await import("./server/pending-tasks.server");
    return pendingTasks(caller);
  });

export const getClassRecordFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.classRecordRead.parse(data))
  .handler(({ data }) => server.getClassRecord(data));
export const saveClassRecordFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.classRecordSave.parse(data))
  .handler(({ data }) => server.saveClassRecord(data));

export const reviewAttemptQuestionFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.questionReview.parse(data))
  .handler(({ data }) => server.reviewAttemptQuestion(data));
export const previewIdentificationRegradeFn = createServerFn({ method: "POST" })
  .validator((data) => server.schemas.regradeIdentification.parse(data))
  .handler(({ data }) => server.previewIdentificationRegrade(data));
