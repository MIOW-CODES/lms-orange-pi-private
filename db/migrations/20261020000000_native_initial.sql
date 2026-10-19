-- Native PostgreSQL schema baseline for MIOW LMS.
-- This is a schema-only fresh-install migration. User, roster, account, and grade records are provisioned privately.
-- Application authorization is enforced by the server. Runtime connections use a non-owner role; no row identity is stored in pooled session state.
-- The database bootstrap creates the private schema and assigns its ownership to the migration role.

CREATE TYPE "public"."announcement_category" AS ENUM (
  'urgent',
  'event',
  'academic'
);

CREATE TYPE "public"."attendance_mark" AS ENUM (
  'on-time',
  'late',
  'excused'
);

CREATE TYPE "public"."component_type" AS ENUM (
  'written_work',
  'performance_task',
  'quarterly_exam'
);

CREATE TYPE "public"."profile_role" AS ENUM (
  'student',
  'teacher',
  'admin'
);

CREATE TYPE "public"."scan_type" AS ENUM (
  'in',
  'out'
);

CREATE TYPE "public"."submission_status" AS ENUM (
  'pending',
  'submitted',
  'graded'
);

CREATE TABLE "public"."announcement_attachments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "announcement_id" uuid NOT NULL,
  "file_url" text NOT NULL,
  "file_name" text,
  "file_size" integer,
  "mime" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."announcements" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "category" announcement_category DEFAULT 'academic'::announcement_category NOT NULL,
  "target_audience" text DEFAULT 'all'::text NOT NULL,
  "author_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "pinned" boolean DEFAULT false NOT NULL
);

CREATE TABLE "public"."app_settings" (
  "key" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."assignments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "course_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "due_date" timestamp with time zone,
  "total_points" integer DEFAULT 100 NOT NULL,
  "component_type" component_type DEFAULT 'written_work'::component_type NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "deleted_at" timestamp with time zone,
  "score_released" boolean DEFAULT false NOT NULL,
  "opens_at" timestamp with time zone,
  "closes_at" timestamp with time zone
);

CREATE TABLE "public"."attendance_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "student_id" uuid NOT NULL,
  "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
  "scan_type" scan_type NOT NULL,
  "status" attendance_mark DEFAULT 'on-time'::attendance_mark NOT NULL,
  "auth_method" text DEFAULT 'pin'::text NOT NULL,
  "device_id" text,
  "course_id" uuid
);

CREATE TABLE "public"."audit_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid,
  "actor_name" text,
  "actor_role" text DEFAULT 'system'::text NOT NULL,
  "action" text NOT NULL,
  "detail" text DEFAULT ''::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."auth_rate_limits" (
  "bucket_key" text NOT NULL,
  "failures" integer DEFAULT 0 NOT NULL,
  "window_started_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."chat_memories" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL,
  "summary" text NOT NULL,
  "last_n_messages" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

CREATE TABLE "public"."class_records" (
  "course_id" uuid NOT NULL,
  "quarter" integer NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "draft" jsonb NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."course_meeting_members" (
  "meeting_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."course_meetings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "course_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "days_of_week" text[] DEFAULT '{}'::text[] NOT NULL,
  "start_time" time without time zone NOT NULL,
  "end_time" time without time zone NOT NULL,
  "capacity" integer,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."course_sections" (
  "course_id" uuid NOT NULL,
  "section_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."courses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "code" text NOT NULL,
  "grade_level" integer NOT NULL,
  "teacher_id" uuid,
  "color" text DEFAULT 'indigo'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "days_of_week" text[],
  "start_time" time without time zone,
  "end_time" time without time zone,
  "late_threshold_minutes" integer DEFAULT 10 NOT NULL,
  "education_level" text DEFAULT 'jhs'::text,
  "college_year" integer,
  "strand" text,
  "program" text,
  "grading_system" text DEFAULT 'k12_quarterly'::text,
  "subject_id" uuid,
  "section_id" uuid
);

CREATE TABLE "public"."enrollments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "student_id" uuid NOT NULL,
  "course_id" uuid NOT NULL
);

CREATE TABLE "public"."feedback_recovery_grants" (
  "report_id" uuid NOT NULL,
  "quiz_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."feedback_reports" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "reporter_id" uuid NOT NULL,
  "category" text NOT NULL,
  "subject" text NOT NULL,
  "description" text NOT NULL,
  "page_url" text,
  "status" text DEFAULT 'open'::text NOT NULL,
  "admin_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone
);

CREATE TABLE "public"."grades" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "student_id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "quarter" integer NOT NULL,
  "written_work_score" numeric,
  "performance_task_score" numeric,
  "exam_score" numeric,
  "transmuted_final_grade" numeric,
  "overridden_by_teacher" boolean DEFAULT false,
  "override_notes" text,
  "overridden_at" timestamp with time zone,
  "overridden_by" uuid,
  "override_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "class_record_snapshot" jsonb
);

CREATE TABLE "public"."notification_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "recipient_email" text,
  "recipient_phone" text,
  "channel" text NOT NULL,
  "event_type" text NOT NULL,
  "title" text NOT NULL,
  "status" text NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."profiles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "student_id" text,
  "email" text,
  "pin" text,
  "full_name" text NOT NULL,
  "role" profile_role DEFAULT 'student'::profile_role NOT NULL,
  "rfid_uid" text,
  "avatar_url" text,
  "grade_level" integer,
  "section" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "pin_hash" text,
  "deleted_at" timestamp with time zone,
  "username" text,
  "password_hash" text,
  "failed_login_attempts" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone,
  "employee_id" text,
  "prefix" text,
  "department" text,
  "phone" text,
  "pin_must_change" boolean DEFAULT true NOT NULL,
  "bio" text,
  "office_hours" text
);

CREATE TABLE "public"."quiz_attempts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "quiz_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "attempt_number" integer DEFAULT 1 NOT NULL,
  "score" integer DEFAULT 0 NOT NULL,
  "total" integer DEFAULT 0 NOT NULL,
  "results" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "released" boolean DEFAULT false NOT NULL,
  "question_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "tab_switches" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "submission_id" uuid,
  "raw_score" integer NOT NULL,
  "integrity_penalty" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "public"."quiz_question_reviews" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "attempt_id" uuid NOT NULL,
  "question_id" uuid NOT NULL,
  "old_correct" boolean NOT NULL,
  "new_correct" boolean NOT NULL,
  "reason" text NOT NULL,
  "reviewer_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."quiz_questions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "quiz_id" uuid NOT NULL,
  "question" text NOT NULL,
  "options" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "correct_answer" text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "image_url" text,
  "lab_task" boolean DEFAULT false NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "question_type" text
);

CREATE TABLE "public"."quiz_retake_grants" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "quiz_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "extra_attempts" integer DEFAULT 1 NOT NULL,
  "granted_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."quiz_retake_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "quiz_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" uuid
);

CREATE TABLE "public"."quiz_score_overrides" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "quiz_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "score" numeric,
  "total" numeric,
  "notes" text,
  "overridden_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."quizzes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "course_id" uuid NOT NULL,
  "title" text NOT NULL,
  "duration_minutes" integer DEFAULT 15 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "allow_retake" boolean DEFAULT false NOT NULL,
  "max_attempts" integer DEFAULT 1 NOT NULL,
  "retake_score_policy" text DEFAULT 'highest_score'::text NOT NULL,
  "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "deleted_at" timestamp with time zone,
  "score_released" boolean DEFAULT false NOT NULL,
  "answer_key_released" boolean DEFAULT false NOT NULL,
  "question_count" integer DEFAULT 0 NOT NULL,
  "opens_at" timestamp with time zone,
  "closes_at" timestamp with time zone
);

CREATE TABLE "public"."rfid_devices" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "location" text,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."sections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "education_level" text DEFAULT 'college'::text,
  "program" text,
  "college_year" integer,
  "adviser_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

CREATE TABLE "public"."sessions" (
  "jti" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "ip" text,
  "user_agent" text,
  "role_view" text
);

CREATE TABLE "public"."subjects" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "units" numeric,
  "lecture_hours" numeric,
  "lab_hours" numeric,
  "description" text,
  "prerequisites" text,
  "education_level" text DEFAULT 'college'::text,
  "program" text,
  "college_year" integer,
  "term" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

CREATE TABLE "public"."submission_files" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL,
  "file_url" text NOT NULL,
  "file_name" text NOT NULL,
  "mime" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."submissions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "assignment_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "file_url" text,
  "content" text,
  "score" numeric,
  "feedback" text,
  "status" submission_status DEFAULT 'pending'::submission_status NOT NULL,
  "submitted_at" timestamp with time zone,
  "file_urls" jsonb DEFAULT '[]'::jsonb
);

CREATE TABLE "public"."tos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "course_id" uuid NOT NULL,
  "quarter" integer NOT NULL,
  "title" text,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "public"."announcement_attachments" ADD CONSTRAINT "announcement_attachments_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."announcements" ADD CONSTRAINT "announcements_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."app_settings" ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY (key);
ALTER TABLE "public"."assignments" ADD CONSTRAINT "assignments_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."attendance_logs" ADD CONSTRAINT "attendance_logs_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."auth_rate_limits" ADD CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY (bucket_key);
ALTER TABLE "public"."chat_memories" ADD CONSTRAINT "chat_memories_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."class_records" ADD CONSTRAINT "class_records_pkey" PRIMARY KEY (course_id, quarter);
ALTER TABLE "public"."course_meeting_members" ADD CONSTRAINT "course_meeting_members_pkey" PRIMARY KEY (meeting_id, student_id);
ALTER TABLE "public"."course_meetings" ADD CONSTRAINT "course_meetings_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."course_sections" ADD CONSTRAINT "course_sections_pkey" PRIMARY KEY (course_id, section_id);
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."enrollments" ADD CONSTRAINT "enrollments_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."feedback_recovery_grants" ADD CONSTRAINT "feedback_recovery_grants_pkey" PRIMARY KEY (report_id);
ALTER TABLE "public"."feedback_reports" ADD CONSTRAINT "feedback_reports_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."grades" ADD CONSTRAINT "grades_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."notification_logs" ADD CONSTRAINT "notification_logs_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."quiz_attempts" ADD CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."quiz_question_reviews" ADD CONSTRAINT "quiz_question_reviews_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."quiz_questions" ADD CONSTRAINT "quiz_questions_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."quiz_retake_grants" ADD CONSTRAINT "quiz_retake_grants_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."quiz_retake_requests" ADD CONSTRAINT "quiz_retake_requests_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."quiz_score_overrides" ADD CONSTRAINT "quiz_score_overrides_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."quizzes" ADD CONSTRAINT "quizzes_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."rfid_devices" ADD CONSTRAINT "rfid_devices_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."sections" ADD CONSTRAINT "sections_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_pkey" PRIMARY KEY (jti);
ALTER TABLE "public"."subjects" ADD CONSTRAINT "subjects_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."submission_files" ADD CONSTRAINT "submission_files_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."submissions" ADD CONSTRAINT "submissions_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."tos" ADD CONSTRAINT "tos_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_code_key" UNIQUE (code);
ALTER TABLE "public"."enrollments" ADD CONSTRAINT "enrollments_student_id_course_id_key" UNIQUE (student_id, course_id);
ALTER TABLE "public"."grades" ADD CONSTRAINT "grades_student_id_course_id_quarter_key" UNIQUE (student_id, course_id, quarter);
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_email_key" UNIQUE (email);
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_rfid_uid_key" UNIQUE (rfid_uid);
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_student_id_key" UNIQUE (student_id);
ALTER TABLE "public"."quiz_retake_grants" ADD CONSTRAINT "quiz_retake_grants_quiz_id_student_id_key" UNIQUE (quiz_id, student_id);
ALTER TABLE "public"."quiz_score_overrides" ADD CONSTRAINT "quiz_score_overrides_quiz_id_student_id_key" UNIQUE (quiz_id, student_id);
ALTER TABLE "public"."sections" ADD CONSTRAINT "sections_name_program_college_year_key" UNIQUE (name, program, college_year);
ALTER TABLE "public"."subjects" ADD CONSTRAINT "subjects_code_key" UNIQUE (code);
ALTER TABLE "public"."submissions" ADD CONSTRAINT "submissions_assignment_id_student_id_key" UNIQUE (assignment_id, student_id);
ALTER TABLE "public"."tos" ADD CONSTRAINT "tos_course_id_quarter_key" UNIQUE (course_id, quarter);
ALTER TABLE "public"."attendance_logs" ADD CONSTRAINT "attendance_logs_auth_method_check" CHECK ((auth_method = ANY (ARRAY['rfid'::text, 'pin'::text])));
ALTER TABLE "public"."auth_rate_limits" ADD CONSTRAINT "auth_rate_limits_failures_check" CHECK ((failures >= 0));
ALTER TABLE "public"."class_records" ADD CONSTRAINT "class_records_quarter_check" CHECK (((quarter >= 1) AND (quarter <= 8)));
ALTER TABLE "public"."course_meetings" ADD CONSTRAINT "course_meetings_capacity_check" CHECK (((capacity IS NULL) OR (capacity > 0)));
ALTER TABLE "public"."course_meetings" ADD CONSTRAINT "course_meetings_check" CHECK ((end_time > start_time));
ALTER TABLE "public"."course_meetings" ADD CONSTRAINT "course_meetings_kind_check" CHECK ((kind = ANY (ARRAY['lecture'::text, 'lab'::text])));
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_college_year_check" CHECK (((college_year >= 1) AND (college_year <= 4)));
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_days_of_week_valid" CHECK (((days_of_week IS NULL) OR (days_of_week <@ ARRAY['mon'::text, 'tue'::text, 'wed'::text, 'thu'::text, 'fri'::text, 'sat'::text, 'sun'::text])));
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_education_level_check" CHECK ((education_level = ANY (ARRAY['jhs'::text, 'shs'::text, 'college'::text])));
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_grading_system_check" CHECK ((grading_system = ANY (ARRAY['k12_quarterly'::text, 'college_semestral'::text])));
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_late_threshold_range" CHECK (((late_threshold_minutes >= 0) AND (late_threshold_minutes <= 60)));
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_time_order" CHECK (((start_time IS NULL) OR (end_time IS NULL) OR (end_time > start_time)));
ALTER TABLE "public"."feedback_reports" ADD CONSTRAINT "feedback_reports_category_check" CHECK ((category = ANY (ARRAY['bug'::text, 'issue'::text, 'feedback'::text, 'course_content'::text, 'other'::text])));
ALTER TABLE "public"."feedback_reports" ADD CONSTRAINT "feedback_reports_description_check" CHECK (((char_length(btrim(description)) >= 1) AND (char_length(btrim(description)) <= 10000)));
ALTER TABLE "public"."feedback_reports" ADD CONSTRAINT "feedback_reports_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'in_review'::text, 'resolved'::text, 'closed'::text])));
ALTER TABLE "public"."feedback_reports" ADD CONSTRAINT "feedback_reports_subject_check" CHECK (((char_length(btrim(subject)) >= 1) AND (char_length(btrim(subject)) <= 200)));
ALTER TABLE "public"."grades" ADD CONSTRAINT "grades_quarter_check" CHECK (((quarter >= 1) AND (quarter <= 8)));
ALTER TABLE "public"."quiz_question_reviews" ADD CONSTRAINT "quiz_question_reviews_reason_check" CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 1000)));
ALTER TABLE "public"."quiz_questions" ADD CONSTRAINT "quiz_questions_question_type_check" CHECK ((question_type = ANY (ARRAY['multiple_choice'::text, 'matching'::text, 'essay'::text, 'identification'::text])));
ALTER TABLE "public"."quiz_retake_grants" ADD CONSTRAINT "quiz_retake_grants_extra_positive" CHECK ((extra_attempts > 0));
ALTER TABLE "public"."quiz_retake_requests" ADD CONSTRAINT "quiz_retake_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])));
ALTER TABLE "public"."quizzes" ADD CONSTRAINT "quizzes_max_attempts_check" CHECK ((max_attempts >= 0));
ALTER TABLE "public"."quizzes" ADD CONSTRAINT "quizzes_retake_policy_check" CHECK ((retake_score_policy = ANY (ARRAY['highest_score'::text, 'latest_attempt'::text, 'average_score'::text])));
ALTER TABLE "public"."sections" ADD CONSTRAINT "sections_college_year_check" CHECK (((college_year >= 1) AND (college_year <= 4)));
ALTER TABLE "public"."sections" ADD CONSTRAINT "sections_education_level_check" CHECK ((education_level = ANY (ARRAY['jhs'::text, 'shs'::text, 'college'::text])));
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_role_view_check" CHECK (((role_view IS NULL) OR (role_view = ANY (ARRAY['teacher'::text, 'admin'::text, 'student'::text]))));
ALTER TABLE "public"."subjects" ADD CONSTRAINT "subjects_college_year_check" CHECK (((college_year >= 1) AND (college_year <= 4)));
ALTER TABLE "public"."subjects" ADD CONSTRAINT "subjects_education_level_check" CHECK ((education_level = ANY (ARRAY['jhs'::text, 'shs'::text, 'college'::text])));
ALTER TABLE "public"."tos" ADD CONSTRAINT "tos_quarter_check" CHECK (((quarter >= 1) AND (quarter <= 8)));
ALTER TABLE "public"."announcement_attachments" ADD CONSTRAINT "announcement_attachments_announcement_id_fkey" FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE;
ALTER TABLE "public"."announcements" ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE "public"."assignments" ADD CONSTRAINT "assignments_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE "public"."attendance_logs" ADD CONSTRAINT "attendance_logs_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE "public"."attendance_logs" ADD CONSTRAINT "attendance_logs_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."chat_memories" ADD CONSTRAINT "chat_memories_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."class_records" ADD CONSTRAINT "class_records_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE "public"."class_records" ADD CONSTRAINT "class_records_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id);
ALTER TABLE "public"."course_meeting_members" ADD CONSTRAINT "course_meeting_members_meeting_id_fkey" FOREIGN KEY (meeting_id) REFERENCES course_meetings(id) ON DELETE CASCADE;
ALTER TABLE "public"."course_meeting_members" ADD CONSTRAINT "course_meeting_members_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."course_meetings" ADD CONSTRAINT "course_meetings_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE "public"."course_sections" ADD CONSTRAINT "course_sections_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE "public"."course_sections" ADD CONSTRAINT "course_sections_section_id_fkey" FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE;
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_section_id_fkey" FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL;
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE "public"."enrollments" ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE "public"."enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."feedback_recovery_grants" ADD CONSTRAINT "feedback_recovery_grants_quiz_id_fkey" FOREIGN KEY (quiz_id) REFERENCES quizzes(id);
ALTER TABLE "public"."feedback_recovery_grants" ADD CONSTRAINT "feedback_recovery_grants_report_id_fkey" FOREIGN KEY (report_id) REFERENCES feedback_reports(id);
ALTER TABLE "public"."feedback_recovery_grants" ADD CONSTRAINT "feedback_recovery_grants_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id);
ALTER TABLE "public"."feedback_reports" ADD CONSTRAINT "feedback_reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."grades" ADD CONSTRAINT "grades_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE "public"."grades" ADD CONSTRAINT "grades_overridden_by_fkey" FOREIGN KEY (overridden_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE "public"."grades" ADD CONSTRAINT "grades_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_fkey" FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
ALTER TABLE "public"."quiz_attempts" ADD CONSTRAINT "quiz_attempts_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."quiz_question_reviews" ADD CONSTRAINT "quiz_question_reviews_attempt_id_fkey" FOREIGN KEY (attempt_id) REFERENCES quiz_attempts(id) ON DELETE CASCADE;
ALTER TABLE "public"."quiz_question_reviews" ADD CONSTRAINT "quiz_question_reviews_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES profiles(id);
ALTER TABLE "public"."quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_fkey" FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
ALTER TABLE "public"."quiz_retake_grants" ADD CONSTRAINT "quiz_retake_grants_granted_by_fkey" FOREIGN KEY (granted_by) REFERENCES profiles(id);
ALTER TABLE "public"."quiz_retake_grants" ADD CONSTRAINT "quiz_retake_grants_quiz_id_fkey" FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
ALTER TABLE "public"."quiz_retake_grants" ADD CONSTRAINT "quiz_retake_grants_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."quiz_retake_requests" ADD CONSTRAINT "quiz_retake_requests_quiz_id_fkey" FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
ALTER TABLE "public"."quiz_retake_requests" ADD CONSTRAINT "quiz_retake_requests_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES profiles(id);
ALTER TABLE "public"."quiz_retake_requests" ADD CONSTRAINT "quiz_retake_requests_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."quiz_score_overrides" ADD CONSTRAINT "quiz_score_overrides_overridden_by_fkey" FOREIGN KEY (overridden_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE "public"."quiz_score_overrides" ADD CONSTRAINT "quiz_score_overrides_quiz_id_fkey" FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
ALTER TABLE "public"."quiz_score_overrides" ADD CONSTRAINT "quiz_score_overrides_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."quizzes" ADD CONSTRAINT "quizzes_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE "public"."sections" ADD CONSTRAINT "sections_adviser_id_fkey" FOREIGN KEY (adviser_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."submission_files" ADD CONSTRAINT "submission_files_submission_id_fkey" FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE;
ALTER TABLE "public"."submissions" ADD CONSTRAINT "submissions_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE;
ALTER TABLE "public"."submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."tos" ADD CONSTRAINT "tos_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;

CREATE INDEX announcement_attachments_announcement_idx ON public.announcement_attachments USING btree (announcement_id);
CREATE INDEX assignments_active_idx ON public.assignments USING btree (course_id) WHERE (deleted_at IS NULL);
CREATE INDEX attendance_logs_course_idx ON public.attendance_logs USING btree (course_id);
CREATE INDEX chat_memories_profile_idx ON public.chat_memories USING btree (profile_id);
CREATE INDEX chat_memories_profile_updated_idx ON public.chat_memories USING btree (profile_id, updated_at DESC);
CREATE INDEX course_meeting_members_student_idx ON public.course_meeting_members USING btree (student_id);
CREATE INDEX course_meetings_course_idx ON public.course_meetings USING btree (course_id, sort_order);
CREATE INDEX course_sections_section_idx ON public.course_sections USING btree (section_id);
CREATE INDEX idx_announcements_author_id ON public.announcements USING btree (author_id);
CREATE INDEX idx_attendance_logs_student_id ON public.attendance_logs USING btree (student_id);
CREATE INDEX idx_attendance_logs_timestamp ON public.attendance_logs USING btree ("timestamp");
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);
CREATE INDEX idx_courses_teacher_id ON public.courses USING btree (teacher_id);
CREATE INDEX idx_enrollments_course_id ON public.enrollments USING btree (course_id);
CREATE INDEX idx_enrollments_student_id ON public.enrollments USING btree (student_id);
CREATE INDEX idx_feedback_reports_reporter_created ON public.feedback_reports USING btree (reporter_id, created_at DESC);
CREATE INDEX idx_feedback_reports_status_created ON public.feedback_reports USING btree (status, created_at DESC);
CREATE INDEX idx_grades_course_id ON public.grades USING btree (course_id);
CREATE INDEX idx_grades_student_id ON public.grades USING btree (student_id);
CREATE INDEX idx_quiz_attempts_quiz_student ON public.quiz_attempts USING btree (quiz_id, student_id);
CREATE INDEX idx_quiz_attempts_student_id ON public.quiz_attempts USING btree (student_id);
CREATE INDEX idx_quiz_questions_quiz_id ON public.quiz_questions USING btree (quiz_id);
CREATE INDEX idx_quiz_retake_requests_quiz_pending ON public.quiz_retake_requests USING btree (quiz_id, requested_at DESC) WHERE (status = 'pending'::text);
CREATE INDEX idx_submissions_assignment_id ON public.submissions USING btree (assignment_id);
CREATE INDEX idx_submissions_student_id ON public.submissions USING btree (student_id);
CREATE INDEX profiles_active_idx ON public.profiles USING btree (role) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX profiles_email_active_key ON public.profiles USING btree (lower(email)) WHERE ((email IS NOT NULL) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX profiles_employee_id_active_key ON public.profiles USING btree (lower(employee_id)) WHERE ((employee_id IS NOT NULL) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX profiles_rfid_uid_active_key ON public.profiles USING btree (rfid_uid) WHERE ((rfid_uid IS NOT NULL) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX profiles_username_unique ON public.profiles USING btree (lower(username)) WHERE (username IS NOT NULL);
CREATE INDEX quiz_attempts_quiz_student_idx ON public.quiz_attempts USING btree (quiz_id, student_id, attempt_number DESC);
CREATE UNIQUE INDEX quiz_attempts_unique_attempt ON public.quiz_attempts USING btree (quiz_id, student_id, attempt_number);
CREATE UNIQUE INDEX quiz_attempts_unique_submission ON public.quiz_attempts USING btree (student_id, submission_id) WHERE (submission_id IS NOT NULL);
CREATE INDEX quiz_question_reviews_attempt_idx ON public.quiz_question_reviews USING btree (attempt_id, created_at);
CREATE INDEX quiz_score_overrides_quiz_idx ON public.quiz_score_overrides USING btree (quiz_id);
CREATE INDEX quizzes_active_idx ON public.quizzes USING btree (course_id) WHERE (deleted_at IS NULL);
CREATE INDEX rfid_devices_key_prefix_idx ON public.rfid_devices USING btree (key_prefix);
CREATE INDEX sections_program_idx ON public.sections USING btree (program);
CREATE INDEX sessions_profile_expires_idx ON public.sessions USING btree (profile_id, expires_at) WHERE (revoked_at IS NULL);
CREATE INDEX subjects_code_idx ON public.subjects USING btree (code);
CREATE INDEX subjects_program_idx ON public.subjects USING btree (program);
CREATE INDEX submission_files_submission_idx ON public.submission_files USING btree (submission_id);
CREATE UNIQUE INDEX uq_quiz_retake_requests_pending ON public.quiz_retake_requests USING btree (quiz_id, student_id) WHERE (status = 'pending'::text);

CREATE OR REPLACE VIEW "public"."question_bank" WITH (security_invoker = true) AS
 SELECT qq.id,
    qq.quiz_id,
    q.course_id,
    c.code AS course_code,
    qq.question,
    qq.options,
    qq.correct_answer,
    qq."position",
    qq.image_url,
    qq.lab_task,
    qq.required,
    qq.created_at,
    q.title AS quiz_title,
    q.created_at AS quiz_created_at,
    q.deleted_at AS quiz_deleted_at,
    qq.question_type
   FROM quiz_questions qq
     JOIN quizzes q ON q.id = qq.quiz_id
     JOIN courses c ON c.id = q.course_id;;

CREATE OR REPLACE FUNCTION private.miow_slug(input text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT regexp_replace(
    translate(
      lower(coalesce(input, '')),
      'áàâäãåéèêëíìîïóòôöõúùûüñçýÿÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÜÑÇÝ',
      'aaaaaaeeeeiiiiooooouuuuncyyAAAAAAEEEEIIIIOOOOOUUUUNCY'
    ),
    '[^a-z0-9]',
    '',
    'g'
  );
$function$;

CREATE OR REPLACE FUNCTION public.check_auth_rate_limit(p_bucket_key text, p_max_failures integer, p_window_seconds integer)
 RETURNS TABLE(allowed boolean, remaining integer)
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    state.window_started_at <= now() - make_interval(secs => p_window_seconds)
      OR state.failures < p_max_failures,
    true
  ),
  GREATEST(0, p_max_failures - COALESCE(
    CASE WHEN state.window_started_at <= now() - make_interval(secs => p_window_seconds)
      THEN 0 ELSE state.failures END,
    0
  ))
  FROM (SELECT 1) seed
  LEFT JOIN public.auth_rate_limits state ON state.bucket_key = p_bucket_key;
$function$;

CREATE OR REPLACE FUNCTION public.clear_auth_rate_limit(p_bucket_key text)
 RETURNS void
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  DELETE FROM public.auth_rate_limits WHERE bucket_key = p_bucket_key;
$function$;

CREATE OR REPLACE FUNCTION public.consume_auth_rate_attempt(p_bucket_key text, p_max_attempts integer, p_window_seconds integer)
 RETURNS TABLE(allowed boolean, remaining integer)
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  next_count integer;
BEGIN
  INSERT INTO public.auth_rate_limits (bucket_key, failures, window_started_at)
  VALUES (p_bucket_key, 1, now())
  ON CONFLICT (bucket_key) DO UPDATE SET
    failures = CASE
      WHEN public.auth_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      THEN 1 ELSE public.auth_rate_limits.failures + 1 END,
    window_started_at = CASE
      WHEN public.auth_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      THEN now() ELSE public.auth_rate_limits.window_started_at END
  RETURNING failures INTO next_count;
  RETURN QUERY SELECT next_count <= p_max_attempts, GREATEST(0, p_max_attempts - next_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_breadboarding_in_sim_questions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.lab_task
     AND NEW.question !~* '(breadboard|wiring|wire|jumper|resistor|pin-to-pin)' THEN
    RAISE EXCEPTION
      'quiz_questions: lab_task questions must include a breadboard wiring task in the question text (mention a breadboard, wire/wiring, jumper, resistor, or pin-to-pin connection)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.enforce_it10_highest_score()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id AND upper(btrim(code))='IT10') THEN
    NEW.retake_score_policy := 'highest_score';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.grant_report_recovery(p_report uuid, p_quiz uuid, p_student uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE inserted uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM feedback_reports WHERE id=p_report AND reporter_id=p_student) THEN
    RAISE EXCEPTION 'Report does not belong to this student';
  END IF;
  INSERT INTO feedback_recovery_grants(report_id,quiz_id,student_id) VALUES(p_report,p_quiz,p_student)
    ON CONFLICT(report_id) DO NOTHING RETURNING report_id INTO inserted;
  IF inserted IS NULL THEN RETURN false; END IF;
  INSERT INTO quiz_retake_grants(quiz_id,student_id,extra_attempts) VALUES(p_quiz,p_student,1)
    ON CONFLICT(quiz_id,student_id) DO UPDATE SET extra_attempts=quiz_retake_grants.extra_attempts+1;
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.grant_retake_on_request_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  base_attempts integer;
  used_attempts integer;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    SELECT CASE WHEN allow_retake THEN max_attempts ELSE 1 END
      INTO base_attempts FROM public.quizzes WHERE id = NEW.quiz_id;
    SELECT count(*) INTO used_attempts FROM public.quiz_attempts
      WHERE quiz_id = NEW.quiz_id AND student_id = NEW.student_id;
    INSERT INTO public.quiz_retake_grants (quiz_id, student_id, extra_attempts, granted_by)
      VALUES (NEW.quiz_id, NEW.student_id, GREATEST(1, used_attempts + 1 - base_attempts), NEW.reviewed_by)
      ON CONFLICT (quiz_id, student_id) DO UPDATE
        SET extra_attempts = GREATEST(public.quiz_retake_grants.extra_attempts + 1,
                                      used_attempts + 1 - base_attempts),
            granted_by = NEW.reviewed_by;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_auth_rate_failure(p_bucket_key text, p_window_seconds integer)
 RETURNS void
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  INSERT INTO public.auth_rate_limits (bucket_key, failures, window_started_at)
  VALUES (p_bucket_key, 1, now())
  ON CONFLICT (bucket_key) DO UPDATE SET
    failures = CASE
      WHEN public.auth_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      THEN 1 ELSE public.auth_rate_limits.failures + 1 END,
    window_started_at = CASE
      WHEN public.auth_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      THEN now() ELSE public.auth_rate_limits.window_started_at END;
$function$;

CREATE OR REPLACE FUNCTION public.review_attempt_question(p_attempt uuid, p_question uuid, p_correct boolean, p_expected boolean, p_reason text, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE attempt quiz_attempts%ROWTYPE; result jsonb; updated_results jsonb; raw integer;
BEGIN
  SELECT * INTO STRICT attempt FROM quiz_attempts WHERE id=p_attempt FOR UPDATE;
  SELECT value INTO result FROM jsonb_array_elements(attempt.results) WHERE value->>'id'=p_question::text;
  IF result IS NULL THEN RAISE EXCEPTION 'Question not found in attempt'; END IF;
  IF (result->>'correct')::boolean IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'This answer was already reviewed. Reload before applying.';
  END IF;
  IF p_correct=p_expected THEN RETURN; END IF;
  INSERT INTO quiz_question_reviews(attempt_id,question_id,old_correct,new_correct,reason,reviewer_id)
    VALUES(p_attempt,p_question,p_expected,p_correct,p_reason,p_actor);
  SELECT jsonb_agg(CASE WHEN value->>'id'=p_question::text THEN jsonb_set(value,'{correct}',to_jsonb(p_correct)) ELSE value END ORDER BY ord)
    INTO updated_results FROM jsonb_array_elements(attempt.results) WITH ORDINALITY AS t(value,ord);
  SELECT count(*) INTO raw FROM jsonb_array_elements(updated_results) WHERE (value->>'correct')::boolean;
  UPDATE quiz_attempts SET results=updated_results, raw_score=raw,
    score=greatest(0, raw-coalesce(attempt.integrity_penalty,0)) WHERE id=p_attempt;
END $function$;

CREATE OR REPLACE FUNCTION public.save_class_record(p_course uuid, p_quarter integer, p_revision integer, p_draft jsonb, p_actor uuid, p_publications jsonb DEFAULT '[]'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE next_revision integer; publication jsonb; snap jsonb;
BEGIN
  IF p_revision = 0 THEN
    INSERT INTO class_records(course_id, quarter, revision, draft, updated_by)
      VALUES(p_course, p_quarter, 1, p_draft, p_actor)
      ON CONFLICT DO NOTHING RETURNING revision INTO next_revision;
  ELSE
    UPDATE class_records SET draft=p_draft, revision=revision+1, updated_by=p_actor, updated_at=now()
      WHERE course_id=p_course AND quarter=p_quarter AND revision=p_revision
      RETURNING revision INTO next_revision;
  END IF;
  IF next_revision IS NULL THEN
    RAISE EXCEPTION 'This class record changed in another window. Reload before saving.';
  END IF;
  FOR publication IN SELECT value FROM jsonb_array_elements(p_publications) LOOP
    snap := publication->'snapshot';
    INSERT INTO grades(student_id, course_id, quarter, written_work_score, performance_task_score,
      exam_score, transmuted_final_grade, class_record_snapshot)
    VALUES ((publication->>'student_id')::uuid, p_course, p_quarter,
      (snap->>'ww')::numeric, (snap->>'pt')::numeric, (snap->>'ex')::numeric,
      CASE WHEN snap->>'scale'='deped' THEN (snap->>'final')::numeric ELSE NULL END, snap)
    ON CONFLICT (student_id, course_id, quarter) DO UPDATE SET
      written_work_score=EXCLUDED.written_work_score, performance_task_score=EXCLUDED.performance_task_score,
      exam_score=EXCLUDED.exam_score, transmuted_final_grade=EXCLUDED.transmuted_final_grade,
      class_record_snapshot=EXCLUDED.class_record_snapshot;
  END LOOP;
  RETURN next_revision;
END $function$;

CREATE TRIGGER trg_require_breadboarding_in_sim_questions BEFORE INSERT OR UPDATE OF question, lab_task ON quiz_questions FOR EACH ROW EXECUTE FUNCTION enforce_breadboarding_in_sim_questions();
CREATE TRIGGER quiz_retake_request_approval_grants_attempt AFTER UPDATE OF status ON quiz_retake_requests FOR EACH ROW EXECUTE FUNCTION grant_retake_on_request_approval();
CREATE TRIGGER enforce_it10_highest_score BEFORE INSERT OR UPDATE OF course_id, retake_score_policy ON quizzes FOR EACH ROW EXECUTE FUNCTION enforce_it10_highest_score();
