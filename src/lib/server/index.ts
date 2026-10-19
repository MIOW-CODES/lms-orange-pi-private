// Barrel re-export: aggregates all server domain modules.
// This preserves backward compatibility — existing `import * as server from "./lms.server"`
// patterns can migrate to `import * as server from "./server"` gradually.

export {
  createSessionToken,
  verifySessionToken,
  sessionJti,
  revokeSessions,
  revokeSessionJti,
  sessionSecret,
} from "./sessions.server";

export {
  requireSession,
  requireStaff,
  requireAdmin,
  requireTeacher,
  requireSelfOrStaff,
  enrolledCourseIds,
  isEnrolledIn,
  requireEnrollment,
} from "./auth.server";

// Availability windows & access policy (P2a) — pure helpers, the seam for
// future auth centralization (Gate-1 amendment #1).
export {
  hasOpened,
  hasClosed,
  deadlineOf,
  availabilityStatus,
  requireOpen,
  AvailabilityError,
  canViewAssessment,
  canAccessCourse,
  isMaterialOpen,
} from "./availability";
export type { AvailabilityRow, AvailabilityStatus, AvailabilityReason } from "./availability";

export {
  safeProfile,
  findByRfid,
  verifyPinLogin,
  getProfileById,
  createProfile,
  updateProfile,
  updateTeacherSettings,
  deleteUser,
  listStudents,
  listStaff,
  listTeachers,
  listTeacherDirectory,
  listAllUsers,
  updateUserRole,
  createTeacher,
  enrollBiometrics,
  uploadAvatar,
  avatarUrlForPath,
  selfServicePatch,
  authorizeProfileUpdate,
  assertUniqueIdentity,
} from "./profiles.server";

export {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  listAnnouncementAttachments,
  uploadAnnouncementMaterial,
  removeAnnouncementAttachment,
} from "./announcements.server";
export type { AnnouncementAttachment } from "./announcements.server";

export { listFeedbackReports, createFeedbackReport, updateFeedbackReport } from "./feedback.server";

export {
  listCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  authorizeCourseUpdate,
  listAssignments,
  createAssignment,
  enrollmentsForCourse,
  enrollmentsForStudent,
  enrollStudent,
  enrollStudents,
  createOrEnrollStudent,
  bulkAddStudents,
  listSubmissionsForStudent,
  listSubmissionsForAssignment,
  gradeSubmission,
  submitAssignment,
  requireCourseOwnerOrAdmin,
} from "./courses.server";

export {
  listQuizzes,
  getQuizPublic,
  submitQuizAttempt,
  quizAttemptInfo,
  listMyQuizSummaries,
  updateQuizRetakePolicy,
  listQuizAttemptsForQuiz,
  grantQuizRetake,
  requestQuizRetake,
  listQuizRetakeRequests,
  reviewQuizRetakeRequest,
  resetQuizAttempts,
  overrideQuizAttempt,
  listStudentAttemptDetail,
  createQuizWithQuestions,
  updateQuiz,
  deleteQuiz,
  requireQuizOwnerOrAdmin,
  gradeEssay,
  parseKeywordCategories,
  listQuizScoresForCourse,
} from "./quizzes.server";

export { listGradesForStudent, listGradesForCourse, upsertGrade } from "./grades.server";

export {
  listCourseMeetings,
  upsertCourseMeeting,
  deleteCourseMeeting,
  setMeetingMembers,
  addMeetingMembers,
  listMeetingMembers,
} from "./meetings.server";

export {
  listSections,
  createSection,
  listCourseSections,
  setCourseSections,
  enrollSectionStudents,
  missingEnrollments,
} from "./sections.server";

export {
  listAttendance,
  listAllAttendance,
  logAttendance,
  bulkLogAttendance,
  recordTap,
  recordTapByProfileId,
  updateAttendanceLog,
  deleteAttendanceLog,
} from "./attendance.server";

export {
  uploadCourseMaterial,
  canAccessCourseMaterialPath,
  removeCourseMaterial,
  attachCourseMaterial,
  uploadSubmissionFile,
  listSubmissionFiles,
  updateAssignment,
  deleteAssignment,
  requireAssignmentOwnerOrAdmin,
  materialUrlForPath,
  countRows,
  hardwareRoster,
} from "./materials.server";

export type { Attachment } from "./materials.server";

export {
  createRfidDevice,
  listRfidDevices,
  deactivateRfidDevice,
  verifyRfidDeviceKey,
  touchRfidDevice,
} from "./rfid-devices.server";
export type { RfidDevicePublic } from "./rfid-devices.server";

export { getKioskLockdown, setKioskLockdown, kioskLockdownInput } from "./app-settings.server";

export { schemas } from "./schemas.server";

export { writeAuditLog, listAuditLogs, clampAuditDetail } from "./audit.server";
export type { AuditActor, AuditLogRow } from "./audit.server";

export { listTosForCourse, upsertTos, deleteTos } from "./tos.server";
export type { TosItem, TosRow, UpsertTosInput, CognitiveLevel } from "./tos.server";

export { listQuestionBank, updateQuestion } from "./question-bank.server";
export type { QuestionBankRow, QuestionPatch } from "./question-bank.server";

export { getClassRecord, saveClassRecord } from "./class-record.server";

export { reviewAttemptQuestion, previewIdentificationRegrade } from "./quizzes.server";
