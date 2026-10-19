import { db } from "@/integrations/db/client.server";
import { requireStaff, requireTeacher } from "./auth.server";
import { requireCourseOwnerOrAdmin, enrollmentsForCourse } from "./courses.server";
import { listQuizScoresForCourse } from "./quizzes.server";
import { unwrap, asJsonParam } from "./utils.server";
import { writeAuditLog } from "./audit.server";
import { schemas } from "./schemas.server";
import {
  calculateRecord,
  emptyRecord,
  scaleForCourse,
  type RecordSource,
  type RecordSnapshot,
  type RecordDraft,
} from "@/lib/class-record";
import type { z } from "zod";

async function recordData(courseId: string, quarter: number, token: string) {
  const [course, record, quizzes, assignments, quizScores, enrolled] = await Promise.all([
    unwrap<{
      id: string;
      code: string;
      grade_level: number;
      education_level?: string | null;
      teacher_id: string | null;
    }>(db.from("courses").select("*").eq("id", courseId).single()),
    unwrap<{ revision: number; draft: RecordDraft } | null>(
      db
        .from("class_records")
        .select("revision,draft")
        .eq("course_id", courseId)
        .eq("quarter", quarter)
        .maybeSingle(),
    ),
    unwrap<Array<{ id: string; title: string; question_count: number }>>(
      db
        .from("quizzes")
        .select("id,title,question_count")
        .eq("course_id", courseId)
        .is("deleted_at", null)
        .order("created_at"),
    ),
    unwrap<Array<{ id: string; title: string; total_points: number }>>(
      db
        .from("assignments")
        .select("id,title,total_points")
        .eq("course_id", courseId)
        .is("deleted_at", null)
        .order("created_at"),
    ),
    listQuizScoresForCourse(courseId, token),
    enrollmentsForCourse(courseId),
  ]);
  const [subs, questions] = await Promise.all([
    assignments.length
      ? unwrap<Array<{ assignment_id: string; student_id: string; score: number | null }>>(
          db
            .from("submissions")
            .select("assignment_id,student_id,score")
            .in(
              "assignment_id",
              assignments.map((a) => a.id),
            ),
        )
      : [],
    quizzes.length
      ? unwrap<Array<{ quiz_id: string }>>(
          db
            .from("quiz_questions")
            .select("quiz_id")
            .in(
              "quiz_id",
              quizzes.map((q) => q.id),
            ),
        )
      : [],
  ]);
  const sources: RecordSource[] = quizzes.map((q) => ({
    id: q.id,
    kind: "quiz",
    title: q.title,
    maximum:
      q.question_count > 0 ? q.question_count : questions.filter((x) => x.quiz_id === q.id).length,
    scores: quizScores.find((s) => s.quiz_id === q.id)?.scores ?? {},
  }));
  for (const a of assignments) {
    const scores: RecordSource["scores"] = {};
    for (const sub of subs)
      if (sub.assignment_id === a.id && sub.score != null)
        scores[sub.student_id] = { score: sub.score, total: a.total_points };
    sources.push({ id: a.id, kind: "assignment", title: a.title, maximum: a.total_points, scores });
  }
  // Roster changes must never widen access or silently admit scores from another course.
  const members = new Set(enrolled);
  for (const source of sources)
    source.scores = Object.fromEntries(
      Object.entries(source.scores).filter(([id]) => members.has(id)),
    );
  return {
    course,
    sources,
    enrolled,
    revision: record?.revision ?? 0,
    draft: record?.draft ?? emptyRecord(),
    scale: scaleForCourse(course),
  };
}
export async function getClassRecord(input: z.infer<typeof schemas.classRecordRead>) {
  await requireStaff(input.token);
  await requireCourseOwnerOrAdmin(input.token, input.courseId);
  return recordData(input.courseId, input.quarter, input.token);
}
export async function saveClassRecord(input: z.infer<typeof schemas.classRecordSave>) {
  const actor = await requireTeacher(input.token);
  await requireCourseOwnerOrAdmin(input.token, input.courseId);
  const data = await recordData(input.courseId, input.quarter, input.token);
  const members = new Set(data.enrolled);
  const draft = input.draft;
  for (const id of [
    ...Object.keys(draft.scores),
    ...Object.keys(draft.attendance),
    ...draft.sessions.flatMap((s) => Object.keys(s.marks)),
    ...input.publishIds,
  ]) {
    if (!members.has(id))
      throw new Error("A student is no longer enrolled. Reload the roster before saving.");
  }
  for (const col of draft.columns) {
    if (
      col.source &&
      !data.sources.some((s) => s.id === col.source!.id && s.kind === col.source!.kind)
    )
      throw new Error(`Assessment unavailable: ${col.title}. Remove or replace its mapping.`);
  }
  for (const scores of Object.values(draft.scores))
    for (const [columnId, score] of Object.entries(scores)) {
      const col = draft.columns.find((c) => c.id === columnId);
      if (!col || score.value > col.maximum)
        throw new Error("A score is outside its assessment's maximum.");
      if (col.source && !score.reason?.trim())
        throw new Error("Provide a reason for each automatic-score override.");
    }
  for (const override of Object.values(draft.attendance))
    if (!override.reason?.trim())
      throw new Error("Provide a reason for each manual attendance percentage.");
  const publishedAt = new Date().toISOString();
  // Stamp score provenance on the server; never trust a client-provided actor/time.
  for (const [studentId, scores] of Object.entries(draft.scores))
    for (const [columnId, score] of Object.entries(scores)) {
      const old = data.draft.scores[studentId]?.[columnId];
      const unchanged = old?.value === score.value && old?.reason === score.reason;
      Object.assign(score, {
        by: unchanged ? (old?.by ?? actor.id) : actor.id,
        at: unchanged ? (old?.at ?? publishedAt) : publishedAt,
      });
    }
  for (const [studentId, score] of Object.entries(draft.attendance)) {
    const old = data.draft.attendance[studentId];
    const unchanged = old?.value === score.value && old?.reason === score.reason;
    Object.assign(score, {
      by: unchanged ? (old?.by ?? actor.id) : actor.id,
      at: unchanged ? (old?.at ?? publishedAt) : publishedAt,
    });
  }
  const publications = [...new Set(input.publishIds)].map((student_id) => {
    const result = calculateRecord(draft, data.sources, student_id, data.scale);
    if (!result.complete)
      throw new Error(
        `Cannot publish incomplete scores: ${result.missing.join(", ")}. Enter missing scores or explicit zeros.`,
      );
    const snapshot: RecordSnapshot = {
      version: 1,
      scale: data.scale,
      attendance: result.attendance!,
      ww: result.categories.ww.percent!,
      ex: result.categories.ex.percent!,
      pt: result.categories.pt.percent!,
      contributions: result.contributions,
      initial: result.initial,
      final: result.final,
      remarks: result.remarks,
      publishedAt,
      publishedBy: actor.id,
    };
    return { student_id, snapshot };
  });
  const response = await db.rpc("save_class_record", {
    p_course: input.courseId,
    p_quarter: input.quarter,
    p_revision: input.revision,
    p_draft: asJsonParam(draft),
    p_actor: actor.id,
    p_publications: asJsonParam(publications),
  });
  if (response.error)
    throw new Error(
      response.error.message?.includes("changed in another")
        ? "This class record changed in another window. Reload before saving."
        : "Could not save class record. No grades were published.",
    );
  const value = response.data as number | Array<{ save_class_record: number }>;
  const revision = typeof value === "number" ? value : value[0]!.save_class_record;
  await writeAuditLog(
    actor,
    publications.length ? "Class record published" : "Class record draft saved",
    `${data.course.code} · period ${input.quarter} · revision ${revision} · ${publications.length} published`,
  );
  return { revision, published: publications.length };
}
