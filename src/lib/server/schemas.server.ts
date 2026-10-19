// Zod validation schemas for all server functions.
import { z } from "zod";

const uuid = z.string().uuid();
const nullableScore = z.number().min(0).max(100).nullable();
const dayCode = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);
const scheduleFields = {
  days_of_week: z.array(dayCode).max(7).nullable().optional(),
  start_time: timeStr.nullable().optional(),
  end_time: timeStr.nullable().optional(),
  late_threshold_minutes: z.number().int().min(0).max(60).optional(),
};

const token = { token: z.string().min(1).max(4096) };

const avatarUrl = z
  .string()
  .max(2048)
  .regex(/^(https:\/\/|\/api\/public\/avatar\?p=)/, "invalid avatar_url");

const attachmentMeta = z.object({
  name: z.string().min(1).max(200),
  url: z.string().max(2048),
  size: z.number().int().min(0).max(20_000_000),
  type: z.string().max(200),
  path: z.string().min(1).max(400),
});

/** Shared student/profile fields, reused by create + create-or-enroll. */
const profileFields = {
  full_name: z.string().min(1).max(200),
  student_id: z.string().max(50).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  role: z.enum(["student", "teacher", "admin"]).optional(),
  grade_level: z.number().int().min(7).max(16).nullable().optional(),
  section: z.string().max(50).nullable().optional(),
  employee_id: z.string().max(50).nullable().optional(),
  prefix: z.string().max(20).nullable().optional(),
  department: z.string().max(100).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  office_hours: z.string().max(500).nullable().optional(),
  pin: z
    .string()
    .regex(/^\d{4,8}$/)
    .nullable()
    .optional(),
  rfid_uid: z
    .string()
    .regex(/^\d{6,20}$/)
    .nullable()
    .optional(),
  avatar_url: avatarUrl.nullable().optional(),
};

/** One row of a Table of Specifications item list (stored as jsonb on tos.items). */
const tosItem = z.object({
  topic: z.string().min(1).max(300),
  no_of_items: z.number().int().min(0).max(1000),
  cognitive_level: z.enum([
    "remembering",
    "understanding",
    "applying",
    "analyzing",
    "evaluating",
    "creating",
  ]),
  quiz_id: uuid.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

// ---- Simulation (lab_task) questions must require breadboard wiring ----
// The Virtual Arduino Lab renders an empty board with manual pin-to-pin wiring,
// so every lab_task question must explicitly require breadboard wiring in its
// question text. Mirrors the DB guard in
// native migrations/20261012000020_require_breadboarding_in_sim_questions.sql.
export const LAB_TASK_WIRING_RE = /breadboard|wiring|wire|jumper|resistor|pin-to-pin/i;

export const LAB_TASK_WIRING_MSG =
  "Simulation (lab task) questions must include a breadboard wiring task in the question text — mention a breadboard, wire/wiring, jumper, resistor, or pin-to-pin connection.";

/**
 * Enforce the breadboarding rule on one question payload. Only simulation
 * (lab_task = true) questions are constrained — lab_task = false (or unset) is
 * free-form. Returns the violation message, or null when acceptable.
 */
export function labTaskWiringProblem(data: {
  question?: string | undefined;
  lab_task?: boolean | undefined;
}): string | null {
  if (data.lab_task !== true) return null;
  if (data.question === undefined) {
    return `${LAB_TASK_WIRING_MSG} Send the question text together with lab_task.`;
  }
  return LAB_TASK_WIRING_RE.test(data.question) ? null : LAB_TASK_WIRING_MSG;
}

const recordScore = z.object({
  value: z.number().finite().min(0).max(100000),
  reason: z.string().trim().min(1).max(1000).optional(),
});
const recordDate = z.union([z.literal(""), z.iso.date()]);
export const classRecordDraftSchema = z
  .object({
    start: recordDate,
    end: recordDate,
    columns: z
      .array(
        z.object({
          id: uuid,
          title: z.string().trim().min(1).max(200),
          category: z.enum(["ww", "ex", "pt"]),
          maximum: z.number().finite().positive().max(100000),
          source: z.object({ kind: z.enum(["quiz", "assignment"]), id: uuid }).optional(),
        }),
      )
      .max(200),
    scores: z.record(uuid, z.record(uuid, recordScore)),
    attendance: z.record(uuid, recordScore.extend({ value: z.number().finite().min(0).max(100) })),
    sessions: z
      .array(
        z.object({
          id: uuid,
          date: z.iso.date(),
          cancelled: z.boolean(),
          marks: z.record(uuid, z.enum(["present", "late", "excused", "absent"])),
        }),
      )
      .max(500),
  })
  .superRefine((draft, ctx) => {
    if (draft.start && draft.end && draft.start > draft.end)
      ctx.addIssue({ code: "custom", message: "Period end must follow its start." });
    if (new Set(draft.columns.map((c) => c.id)).size !== draft.columns.length)
      ctx.addIssue({ code: "custom", message: "Duplicate assessment columns." });
    const sources = draft.columns.flatMap((c) =>
      c.source ? [`${c.source.kind}:${c.source.id}`] : [],
    );
    if (new Set(sources).size !== sources.length)
      ctx.addIssue({ code: "custom", message: "An assessment can only appear once per period." });
    if (new Set(draft.sessions.map((s) => s.id)).size !== draft.sessions.length)
      ctx.addIssue({ code: "custom", message: "Duplicate sessions." });
  });

export const schemas = {
  questionReview: z.object({
    quizId: uuid,
    attemptId: uuid,
    questionId: uuid,
    correct: z.boolean(),
    expected: z.boolean(),
    reason: z.string().trim().min(1).max(1000),
    ...token,
  }),
  regradeIdentification: z.object({ quizId: uuid, ...token }),
  classRecordRead: z.object({ courseId: uuid, quarter: z.number().int().min(1).max(8), ...token }),
  classRecordSave: z.object({
    courseId: uuid,
    quarter: z.number().int().min(1).max(8),
    revision: z.number().int().nonnegative(),
    draft: classRecordDraftSchema,
    publishIds: z.array(uuid).max(1000).default([]),
    ...token,
  }),
  rfid: z.object({ uid: z.string().min(1).max(64) }),
  pinLogin: z.object({ login: z.string().min(1).max(320), secret: z.string().min(1).max(200) }),
  avatarUpload: z.object({
    data: z.string().min(1).max(3_000_000),
    content_type: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    ...token,
  }),
  session: z.object(token),
  id: z.object({ id: uuid, ...token }),
  studentScoped: z.object({ studentId: uuid, ...token }),
  courseScoped: z.object({ courseId: uuid, ...token }),
  courseQuarter: z.object({ courseId: uuid, quarter: z.number().int().min(1).max(8), ...token }),
  limit: z.object({ limit: z.number().int().min(1).max(500), ...token }),
  roleUpdate: z.object({ id: uuid, role: z.enum(["student", "teacher", "admin"]), ...token }),
  enrollment: z.object({ student_id: uuid, course_id: uuid, ...token }),
  enrollmentBatch: z.object({
    course_id: uuid,
    student_ids: z.array(uuid).min(1).max(500),
    ...token,
  }),
  courseMeeting: z.object({
    id: uuid.optional(),
    course_id: uuid,
    kind: z.enum(["lecture", "lab"]),
    label: z.string().min(1).max(120),
    days_of_week: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).max(7),
    start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    capacity: z.number().int().min(1).max(500).nullable().optional(),
    sort_order: z.number().int().optional(),
    ...token,
  }),
  meetingMembers: z.object({
    meeting_id: uuid,
    student_ids: z.array(uuid).max(500),
    ...token,
  }),
  // Bulk roster import: create-or-enroll a batch of class-list rows, optionally
  // into a course and one of its meetings (lecture/lab). Roster fields only —
  // bulk import can never set credentials (PIN / RFID / email login).
  bulkStudentEnroll: z.object({
    students: z
      .array(
        z.object({
          full_name: z.string().min(1).max(200),
          student_id: z.string().max(50).nullable().optional(),
          email: z.string().max(320).nullable().optional(),
          grade_level: z.number().int().min(7).max(16).nullable().optional(),
          section: z.string().max(50).nullable().optional(),
          avatar_url: avatarUrl.nullable().optional(),
        }),
      )
      .min(1)
      .max(300),
    course_id: uuid.nullable().optional(),
    meeting_id: uuid.nullable().optional(),
    ...token,
  }),
  sectionCreate: z.object({
    name: z.string().min(1).max(60),
    education_level: z.enum(["jhs", "shs", "college"]),
    ...token,
  }),
  courseSectionsLink: z.object({
    course_id: uuid,
    section_ids: z.array(uuid).max(50),
    ...token,
  }),
  attendance: z.object({
    student_id: uuid,
    scan_type: z.enum(["in", "out"]),
    status: z.enum(["on-time", "late", "excused"]),
    timestamp: z.string().max(50).optional(),
    course_id: uuid.nullable().optional(),
    ...token,
  }),
  bulkAttendanceLog: z.object({
    items: z
      .array(
        z.object({
          student_id: uuid,
          scan_type: z.enum(["in", "out"]),
          status: z.enum(["on-time", "late", "excused"]),
          timestamp: z.string().max(50).optional(),
          course_id: uuid.nullable().optional(),
        }),
      )
      .min(1)
      .max(1000),
    ...token,
  }),
  attendancePatch: z.object({
    id: uuid,
    patch: z
      .object({
        status: z.enum(["on-time", "late", "excused"]),
        scan_type: z.enum(["in", "out"]),
      })
      .partial(),
    ...token,
  }),
  profileInput: z.object({
    ...profileFields,
    ...token,
  }),
  // Enroll a new OR existing student (matched by student_id/email) into a
  // course in one step. `course_id` is optional so the same call can create a
  // bare student record.
  studentEnroll: z.object({
    ...profileFields,
    course_id: uuid.nullable().optional(),
    ...token,
  }),
  teacherInput: z.object({
    full_name: z.string().min(1).max(200),
    prefix: z.string().max(20).nullable().optional(),
    email: z.string().min(3).max(320),
    employee_id: z.string().min(1).max(50),
    department: z.string().min(1).max(100),
    pin: z.string().regex(/^\d{4,6}$/),
    rfid_uid: z
      .string()
      .regex(/^\d{6,20}$/)
      .nullable()
      .optional(),
    ...token,
  }),
  biometrics: z.object({
    id: uuid,
    rfid_uid: z
      .string()
      .regex(/^\d{6,20}$/)
      .nullable()
      .optional(),
    ...token,
  }),
  profilePatch: z.object({
    id: uuid,
    patch: z
      .object({
        full_name: z.string().min(1).max(200).nullable(),
        student_id: z.string().max(50).nullable(),
        email: z.string().max(320).nullable(),
        grade_level: z.number().int().min(7).max(16).nullable(),
        section: z.string().max(50).nullable(),
        employee_id: z.string().max(50).nullable(),
        prefix: z.string().max(20).nullable(),
        department: z.string().max(100).nullable(),
        pin: z
          .string()
          .regex(/^\d{4,8}$/)
          .nullable(),
        rfid_uid: z
          .string()
          .regex(/^\d{6,20}$/)
          .nullable(),
        avatar_url: avatarUrl.nullable(),
      })
      .partial(),
    ...token,
  }),
  teacherSettings: z.object({
    patch: z
      .object({
        full_name: z.string().min(1).max(200),
        email: z.string().max(320).nullable(),
        avatar_url: avatarUrl.nullable(),
        prefix: z.string().max(20).nullable().optional(),
        department: z.string().max(100).nullable().optional(),
        phone: z.string().max(30).nullable().optional(),
        bio: z.string().max(2000).nullable().optional(),
        office_hours: z.string().max(500).nullable().optional(),
        pin: z
          .string()
          .regex(/^\d{4,6}$/)
          .nullable(),
        rfid_uid: z
          .string()
          .regex(/^\d{6,20}$/)
          .nullable(),
      })
      .partial(),
    ...token,
  }),
  announcementInput: z.object({
    title: z.string().min(1).max(300),
    content: z.string().min(1).max(5000),
    category: z.enum(["urgent", "event", "academic"]),
    target_audience: z.string().max(50).optional(),
    // Pin-on-create: without this the field is stripped by the schema and the
    // insert never persists it (announcementPatch already allows pinned).
    pinned: z.boolean().optional(),
    author_id: uuid.nullable().optional(),
    ...token,
  }),
  courseInput: z.object({
    title: z.string().min(1).max(200),
    code: z.string().min(1).max(20),
    grade_level: z.number().int().min(7).max(16),
    education_level: z.enum(["jhs", "shs", "college"]).optional(),
    college_year: z.number().int().min(1).max(4).nullable().optional(),
    strand: z.string().max(50).nullable().optional(),
    program: z.string().max(80).nullable().optional(),
    grading_system: z.enum(["k12_quarterly", "college_semestral"]).optional(),
    teacher_id: uuid.nullable().optional(),
    color: z.string().max(20).optional(),
    ...scheduleFields,
    ...token,
  }),
  coursePatch: z.object({
    id: uuid,
    patch: z
      .object({
        title: z.string().min(1).max(200),
        code: z.string().min(1).max(20),
        grade_level: z.number().int().min(7).max(16),
        education_level: z.enum(["jhs", "shs", "college"]).nullable().optional(),
        college_year: z.number().int().min(1).max(4).nullable().optional(),
        strand: z.string().max(50).nullable().optional(),
        program: z.string().max(80).nullable().optional(),
        grading_system: z.enum(["k12_quarterly", "college_semestral"]).nullable().optional(),
        teacher_id: uuid.nullable(),
        color: z.string().max(20),
        days_of_week: z.array(dayCode).max(7).nullable(),
        start_time: timeStr.nullable(),
        end_time: timeStr.nullable(),
        late_threshold_minutes: z.number().int().min(0).max(60),
      })
      .partial(),
    ...token,
  }),
  tap: z.object({
    uid: z.string().min(1).max(64),
    at: z.string().max(40).optional(),
    ...token,
  }),
  rfidDeviceCreate: z.object({
    name: z.string().min(1).max(100),
    location: z.string().max(200).nullable().optional(),
    ...token,
  }),
  announcementPatch: z.object({
    id: uuid,
    patch: z
      .object({
        title: z.string().min(1).max(300),
        content: z.string().min(1).max(5000),
        category: z.enum(["urgent", "event", "academic"]),
        target_audience: z.string().max(50),
        pinned: z.boolean(),
      })
      .partial(),
    ...token,
  }),
  feedbackReportInput: z.object({
    category: z.enum(["bug", "issue", "feedback", "course_content", "other"]),
    subject: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(10000),
    page_url: z.string().max(2048).nullable().optional(),
    ...token,
  }),
  feedbackReportPatch: z.object({
    id: uuid,
    patch: z
      .object({
        status: z.enum(["open", "in_review", "resolved", "closed"]),
        admin_note: z.string().max(5000).nullable(),
      })
      .partial(),
    ...token,
  }),
  assignmentInput: z.object({
    course_id: uuid,
    title: z.string().min(1).max(300),
    description: z.string().max(5000).nullable().optional(),
    due_date: z.string().max(40).nullable().optional(),
    // Availability window (P2a): null opens_at = open now, null closes_at = no
    // hard close from that column (due_date still hard-blocks assignments).
    opens_at: z.string().max(40).nullable().optional(),
    closes_at: z.string().max(40).nullable().optional(),
    total_points: z.number().int().min(1).max(1000).optional(),
    component_type: z.enum(["written_work", "performance_task", "quarterly_exam"]).optional(),
    attachments: z.array(attachmentMeta).max(10).optional(),
    ...token,
  }),
  submissionInput: z.object({
    assignment_id: uuid,
    student_id: uuid,
    content: z.string().max(20000).nullable().optional(),
    file_url: z.string().max(2048).nullable().optional(),
    file_urls: z
      .array(
        z.object({
          url: z.string().max(2048),
          name: z.string().max(200),
          size: z.number().int().min(0).max(50_000_000),
          type: z.string().max(200),
        }),
      )
      .max(10)
      .optional(),
    // `status` is staff-only: ignored for student callers (see
    // submitAssignment in courses.server.ts) and kept so staff may still set
    // it. `submitted_at` is server-set on every write — clients cannot spoof it.
    status: z.enum(["pending", "submitted", "graded"]).optional(),
    ...token,
  }),
  submissionUpload: z.object({
    submission_id: uuid,
    name: z.string().min(1).max(200),
    data: z.string().min(1).max(21_000_000),
    content_type: z.string().min(3).max(200),
    ...token,
  }),
  assignmentScoped: z.object({ assignmentId: uuid, ...token }),
  gradeSubmission: z.object({
    id: uuid,
    patch: z.object({
      score: z.number().min(0).max(1000).nullable(),
      feedback: z.string().max(5000).nullable(),
      status: z.enum(["pending", "submitted", "graded"]).optional(),
    }),
    ...token,
  }),
  attemptOverride: z.object({
    quiz_id: uuid,
    student_id: uuid,
    score: z.number().min(0).max(10000).nullable(),
    total: z.number().min(1).max(10000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    ...token,
  }),
  attemptDetail: z.object({ quiz_id: uuid, student_id: uuid, ...token }),
  gradeInput: z.object({
    student_id: uuid,
    course_id: uuid,
    quarter: z.number().int().min(1).max(8),
    written_work_score: nullableScore,
    performance_task_score: nullableScore,
    exam_score: nullableScore,
    transmuted_final_grade: z.number().min(0).max(100).nullable().optional(),
    overridden_by_teacher: z.boolean().optional(),
    override_notes: z.string().max(2000).nullable().optional(),
    override_flags: z.record(z.string(), z.any()).optional(),
    ...token,
  }),
  quizBundle: z.object({
    quiz: z.object({
      course_id: uuid,
      title: z.string().min(1).max(300),
      duration_minutes: z.number().int().min(1).max(180).optional(),
      allow_retake: z.boolean().optional(),
      max_attempts: z.number().int().min(0).max(50).optional(),
      retake_score_policy: z.enum(["highest_score", "latest_attempt", "average_score"]).optional(),
      question_count: z.number().int().min(0).max(100).optional(),
      attachments: z.array(attachmentMeta).max(10).optional(),
      // Availability window (P2a): null = open now / no hard close.
      opens_at: z.string().max(40).nullable().optional(),
      closes_at: z.string().max(40).nullable().optional(),
    }),
    questions: z
      .array(
        z
          .object({
            question: z.string().min(1).max(2000),
            options: z.array(z.string().min(1).max(500)).max(12),
            correct_answer: z.string().min(1).max(1000),
            // Optional simulation flag (mirrors QuizQuestion in lms.ts). When
            // set, the question text must require breadboard wiring.
            lab_task: z.boolean().optional(),
          })
          .superRefine((data, ctx) => {
            const problem = labTaskWiringProblem(data);
            if (problem) {
              ctx.addIssue({
                code: "custom",
                message: problem,
                path: ["question"],
                input: data,
              });
            }
          })
          // MCQ answer-key sanity (create path only): a correct answer that is
          // not one of the options can never be selected, making the question
          // impossible to answer correctly. Option-less items and essay
          // ("Rubric:") keys are exempt; multi-variant keys ("answerA ||
          // answerB") are judged on their first variant. Deliberately NOT
          // applied to updateQuestion / quizUpdate so existing rows and edits
          // are unaffected.
          .superRefine((data, ctx) => {
            if (data.options.length === 0) return;
            if (data.correct_answer.startsWith("Rubric:")) return;
            const primary = (data.correct_answer.split("||")[0] ?? "").trim();
            const optionKeys = data.options.map((o) => o.trim());
            if (!optionKeys.includes(primary)) {
              ctx.addIssue({
                code: "custom",
                message: "correct answer must be one of the options",
                path: ["correct_answer"],
                input: data,
              });
            }
          }),
      )
      .min(1)
      .max(100),
    ...token,
  }),
  quizGrade: z.object({
    quiz_id: uuid,
    // Generous cap: Part IV lab_task items require full Arduino sketches /
    // multi-line connection write-ups, which easily exceed 500 chars. A hard
    // 500-char limit made those answers un-submittable (ZodError, no attempt
    // recorded). 5000 chars comfortably fits realistic sketches.
    answers: z.record(z.string().uuid(), z.string().max(5000)),
    question_ids: z.array(uuid).optional(),
    tab_switches: z
      .array(
        z.object({
          at: z.number(),
          type: z.enum([
            "blur",
            "visibilitychange",
            "fullscreenchange",
            "devtools",
            "paste",
            "contextmenu",
          ]),
        }),
      )
      .max(500)
      .optional(),
    // Client-generated idempotency key: a retry of the same attempt reuses it
    // so the server can replay the stored result instead of double-recording.
    submission_id: uuid.optional(),
    ...token,
  }),
  quizScoped: z.object({ quiz_id: uuid, ...token }),
  quizPolicy: z.object({
    id: uuid,
    allow_retake: z.boolean(),
    max_attempts: z.number().int().min(0).max(50),
    retake_score_policy: z.enum(["highest_score", "latest_attempt", "average_score"]),
    ...token,
  }),
  retakeGrant: z.object({ quiz_id: uuid, student_id: uuid, ...token }),
  retakeRequest: z.object({ quiz_id: uuid, ...token }),
  retakeRequestReview: z.object({
    request_id: uuid,
    decision: z.enum(["approved", "denied"]),
    ...token,
  }),
  materialUpload: z.object({
    course_id: uuid,
    name: z.string().min(1).max(200),
    data: z.string().min(1).max(21_000_000),
    content_type: z.string().min(3).max(200),
    ...token,
  }),
  materialAttach: z.object({
    target: z.enum(["quiz", "assignment"]),
    id: uuid,
    attachment: attachmentMeta,
    ...token,
  }),
  materialRemove: z.object({
    target: z.enum(["quiz", "assignment"]),
    id: uuid,
    path: z.string().min(1).max(400),
    ...token,
  }),
  quizUpdate: z.object({
    id: uuid,
    patch: z
      .object({
        title: z.string().min(1).max(300),
        duration_minutes: z.number().int().min(1).max(180),
        allow_retake: z.boolean(),
        max_attempts: z.number().int().min(0).max(50),
        retake_score_policy: z.enum(["highest_score", "latest_attempt", "average_score"]),
        attachments: z.array(attachmentMeta).max(10),
        score_released: z.boolean(),
        answer_key_released: z.boolean(),
        opens_at: z.string().max(40).nullable(),
        closes_at: z.string().max(40).nullable(),
      })
      .partial(),
    questions: z
      .array(
        z.object({
          question: z.string().min(1).max(2000),
          options: z.array(z.string().min(1).max(500)).max(12),
          correct_answer: z.string().min(1).max(1000),
        }),
      )
      .max(100)
      .optional(),
    ...token,
  }),
  assignmentPatch: z.object({
    id: uuid,
    patch: z
      .object({
        title: z.string().min(1).max(300),
        description: z.string().max(5000).nullable(),
        due_date: z.string().max(40).nullable(),
        total_points: z.number().int().min(1).max(1000),
        component_type: z.enum(["written_work", "performance_task", "quarterly_exam"]),
        attachments: z.array(attachmentMeta).max(10),
        score_released: z.boolean(),
        opens_at: z.string().max(40).nullable(),
        closes_at: z.string().max(40).nullable(),
      })
      .partial(),
    ...token,
  }),
  contentDelete: z.object({ id: uuid, mode: z.enum(["soft", "hard"]), ...token }),
  // ---- TOS (Table of Specifications) ----
  tosItem,
  tosUpsert: z.object({
    id: uuid.optional(),
    courseId: uuid,
    quarter: z.number().int().min(1).max(8),
    title: z.string().max(300).nullable().optional(),
    items: z.array(tosItem).max(200),
    ...token,
  }),
  // ---- Question bank ----
  questionBankList: z.object({ courseId: uuid.nullable().optional(), ...token }),
  questionUpdate: z.object({
    id: uuid,
    patch: z
      .object({
        question: z.string().min(1).max(2000),
        options: z.array(z.string().min(1).max(500)).max(12),
        correct_answer: z.string().min(1).max(1000),
        lab_task: z.boolean(),
        required: z.boolean(),
        image_url: z.string().max(2_000_000).nullable(),
      })
      .partial()
      .superRefine((data, ctx) => {
        const problem = labTaskWiringProblem(data);
        if (problem) {
          ctx.addIssue({
            code: "custom",
            message: problem,
            path: ["question"],
            input: data,
          });
        }
      }),
    ...token,
  }),
  announcementMaterialUpload: z.object({
    announcement_id: uuid,
    name: z.string().min(1).max(200),
    data: z.string().min(1).max(21_000_000),
    content_type: z.string().min(3).max(200),
    ...token,
  }),
  announcementMaterialRemove: z.object({
    attachment_id: uuid,
    ...token,
  }),
  countable: z.object({
    table: z.enum([
      "profiles",
      "announcements",
      "courses",
      "enrollments",
      "assignments",
      "submissions",
      "quizzes",
      "quiz_questions",
      "grades",
      "attendance_logs",
    ]),
    ...token,
  }),
};
