import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Pool } from "pg";

if (process.env["MIOW_PG_INTEGRATION_RUN"] !== "1") {
  throw new Error("Run native PostgreSQL integration tests with `bun run test:integration`.");
}

const databaseUrl = process.env["DATABASE_URL"]?.trim();
if (!databaseUrl)
  throw new Error("DATABASE_URL is required for native PostgreSQL integration tests");

const db = new Pool({ connectionString: databaseUrl, max: 3 });
const course = crypto.randomUUID();
const other = crypto.randomUUID();
const actor = crypto.randomUUID();
const student = crypto.randomUUID();
const quiz = crypto.randomUUID();
const otherQuiz = crypto.randomUUID();
const attempt = crypto.randomUUID();
const question = crypto.randomUUID();
const report = crypto.randomUUID();

beforeAll(async () => {
  await db.query(
    `INSERT INTO public.profiles (id, email, full_name, role)
     VALUES ($1, 'admin@example.test', 'Test Admin', 'admin'),
            ($2, 'student@example.test', 'Test Student', 'student')`,
    [actor, student],
  );
  await db.query(
    `INSERT INTO public.courses (id, title, code, grade_level)
     VALUES ($1, 'Information Technology 10', 'IT10', 10),
            ($2, 'Other Course', 'OTHER', 10)`,
    [course, other],
  );
  await db.query(
    `INSERT INTO public.quizzes (id, course_id, title, retake_score_policy)
     VALUES ($1, $2, 'IT10 Quiz', 'latest_attempt'),
            ($3, $4, 'Other Quiz', 'average_score')`,
    [quiz, course, otherQuiz, other],
  );
});

afterAll(() => db.end());

function save(revision: number, publications: unknown[] = []) {
  return db.query(
    "SELECT public.save_class_record($1::uuid, 1, $2::integer, $3::jsonb, $4::uuid, $5::jsonb)",
    [course, revision, JSON.stringify({ columns: [] }), actor, JSON.stringify(publications)],
  );
}

describe("native PostgreSQL class-record and repair functions", () => {
  it("saves drafts without publishing and rejects stale revisions", async () => {
    await save(0);
    expect((await db.query("SELECT * FROM public.grades")).rows).toHaveLength(0);
    await expect(save(0)).rejects.toThrow("changed in another window");
  });

  it("rolls back the entire save when any selected publication fails", async () => {
    const snapshot = { ww: 100, pt: 100, ex: 100, scale: "college", final: 1 };
    await expect(
      save(1, [
        { student_id: student, snapshot },
        { student_id: crypto.randomUUID(), snapshot },
      ]),
    ).rejects.toThrow();
    expect(
      (await db.query<{ revision: number }>("SELECT revision FROM public.class_records")).rows[0]!
        .revision,
    ).toBe(1);
    expect((await db.query("SELECT * FROM public.grades")).rows).toHaveLength(0);
  });

  it("publishes decimal college grades in the snapshot without a DepEd value", async () => {
    await save(1, [
      { student_id: student, snapshot: { ww: 85, pt: 90, ex: 88, scale: "college", final: 1.5 } },
    ]);
    const row = (
      await db.query<{
        class_record_snapshot: { final: number };
        transmuted_final_grade: number | null;
      }>("SELECT * FROM public.grades")
    ).rows[0]!;
    expect(row.class_record_snapshot.final).toBe(1.5);
    expect(row.transmuted_final_grade).toBe(null);
  });

  it("enforces IT10 highest-score policy without changing other courses", async () => {
    const rows = (
      await db.query<{ course_id: string; retake_score_policy: string }>(
        "SELECT course_id, retake_score_policy FROM public.quizzes",
      )
    ).rows;
    expect(rows.find((row) => row.course_id === course)!.retake_score_policy).toBe("highest_score");
    expect(rows.find((row) => row.course_id === other)!.retake_score_policy).toBe("average_score");
  });

  it("grants one extra attempt on a pending-to-approved retake request only once", async () => {
    const request = crypto.randomUUID();
    await db.query(
      `INSERT INTO public.quiz_retake_requests (id, quiz_id, student_id)
       VALUES ($1, $2, $3)`,
      [request, quiz, student],
    );
    await db.query(
      `UPDATE public.quiz_retake_requests
          SET status = 'approved', reviewed_by = $2, reviewed_at = now()
        WHERE id = $1`,
      [request, actor],
    );
    await db.query("UPDATE public.quiz_retake_requests SET status = 'approved' WHERE id = $1", [
      request,
    ]);
    const grant = (
      await db.query<{ extra_attempts: number; granted_by: string }>(
        "SELECT extra_attempts, granted_by FROM public.quiz_retake_grants WHERE quiz_id = $1 AND student_id = $2",
        [quiz, student],
      )
    ).rows[0]!;
    expect(grant.extra_attempts).toBe(1);
    expect(grant.granted_by).toBe(actor);
  });

  it("reviews exactly one question, preserves responses and penalties, and records an audit", async () => {
    const results = [
      { id: question, chosen: "the third gives the multiplier", correct: false },
      { id: crypto.randomUUID(), chosen: "another answer", correct: true },
    ];
    await db.query(
      `INSERT INTO public.quiz_attempts
         (id, quiz_id, student_id, results, raw_score, integrity_penalty, score, total)
       VALUES ($1, $2, $3, $4::jsonb, 1, 1, 0, 2)`,
      [attempt, quiz, student, JSON.stringify(results)],
    );
    await db.query(
      "SELECT public.review_attempt_question($1::uuid,$2::uuid,true,false,'Verified rubric explanation',$3::uuid)",
      [attempt, question, actor],
    );
    const row = (
      await db.query<{
        score: number;
        raw_score: number;
        integrity_penalty: number;
        results: typeof results;
      }>("SELECT * FROM public.quiz_attempts WHERE id = $1", [attempt])
    ).rows[0]!;
    expect(row.raw_score).toBe(2);
    expect(row.score).toBe(1);
    expect(row.integrity_penalty).toBe(1);
    expect(row.results[0]!.chosen).toBe(results[0]!.chosen);
    expect((await db.query("SELECT * FROM public.quiz_question_reviews")).rows).toHaveLength(1);
    await expect(
      db.query(
        "SELECT public.review_attempt_question($1::uuid,$2::uuid,true,false,'duplicate',$3::uuid)",
        [attempt, question, actor],
      ),
    ).rejects.toThrow("already reviewed");
  });

  it("grants one recovery attempt exactly once per report, including retries", async () => {
    await db.query(
      `INSERT INTO public.feedback_reports (id, reporter_id, category, subject, description)
       VALUES ($1, $2, 'feedback', 'Retake request', 'Recovery test')`,
      [report, student],
    );
    await db.query("SELECT public.grant_report_recovery($1::uuid,$2::uuid,$3::uuid)", [
      report,
      otherQuiz,
      student,
    ]);
    await db.query("SELECT public.grant_report_recovery($1::uuid,$2::uuid,$3::uuid)", [
      report,
      otherQuiz,
      student,
    ]);
    const grant = (
      await db.query<{ extra_attempts: number }>(
        "SELECT extra_attempts FROM public.quiz_retake_grants WHERE quiz_id = $1 AND student_id = $2",
        [otherQuiz, student],
      )
    ).rows[0]!;
    expect(grant.extra_attempts).toBe(1);
    expect((await db.query("SELECT * FROM public.feedback_recovery_grants")).rows).toHaveLength(1);
  });
});
