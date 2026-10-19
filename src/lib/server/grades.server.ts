/* eslint-disable @typescript-eslint/no-explicit-any */
// Grades — CRUD + DepEd transmutation.
import { z } from "zod";
import { db } from "@/integrations/db/client.server";
import { unwrap, withoutToken } from "@/lib/server/utils.server";
import { schemas } from "@/lib/server/schemas.server";
import { verifySessionToken } from "@/lib/server/sessions.server";

export async function listGradesForStudent(studentId: string) {
  return unwrap<any[]>(db.from("grades").select("*").eq("student_id", studentId));
}

export async function listGradesForCourse(courseId: string, quarter: number) {
  return unwrap<any[]>(
    db.from("grades").select("*").eq("course_id", courseId).eq("quarter", quarter),
  );
}

export async function upsertGrade(input: z.infer<typeof schemas.gradeInput>, callerId?: string) {
  let resolvedCallerId = callerId;
  if (!resolvedCallerId && input.token) {
    try {
      resolvedCallerId = verifySessionToken(input.token);
    } catch {
      // leave unset rather than guessing
    }
  }

  const existing = await unwrap<{ id: string; class_record_snapshot?: unknown } | null>(
    db
      .from("grades")
      .select("id,class_record_snapshot")
      .eq("student_id", input.student_id)
      .eq("course_id", input.course_id)
      .eq("quarter", input.quarter)
      .maybeSingle(),
  );

  if (existing?.class_record_snapshot)
    throw new Error("Use the Class Record tab to revise and republish these grades.");
  const row: Record<string, any> = withoutToken(input);

  if (input.override_flags !== undefined) {
    const rawFlags =
      input.override_flags && typeof input.override_flags === "object" ? input.override_flags : {};
    const flags: Record<string, any> = {};
    const nowIso = new Date().toISOString();
    for (const [key, val] of Object.entries(rawFlags)) {
      if (val && typeof val === "object") {
        flags[key] = {
          ...val,
          at: (val as any).at ?? nowIso,
          ...(resolvedCallerId && !(val as any).by ? { by: resolvedCallerId } : {}),
        };
      } else {
        flags[key] = val;
      }
    }
    const hasOverride = ["ww", "pt", "ex"].some(
      (k) => k in flags && flags[k] !== null && flags[k] !== undefined,
    );
    row["override_flags"] = flags;
    row["overridden_by_teacher"] = hasOverride;
  }

  if (existing) await unwrap(db.from("grades").update(row).eq("id", existing.id));
  else await unwrap(db.from("grades").insert(row));
}
