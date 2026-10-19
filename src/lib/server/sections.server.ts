/* eslint-disable @typescript-eslint/no-explicit-any */
// School sections (cohorts) and course section linkings.
import { z } from "zod";
import { db } from "@/integrations/db/client.server";
import { unwrap, withoutToken, isUniqueViolation } from "@/lib/server/utils.server";
import { schemas } from "@/lib/server/schemas.server";

export async function listSections() {
  return unwrap<any[]>(
    db.from("sections").select("*").is("deleted_at", null).order("education_level").order("name"),
  );
}

export async function createSection(input: z.infer<typeof schemas.sectionCreate>) {
  const row = withoutToken(input);
  const existing = await unwrap<any>(
    db
      .from("sections")
      .select("*")
      .eq("name", row.name)
      .eq("education_level", row.education_level)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  if (existing) return existing;

  try {
    return await unwrap<any>(db.from("sections").insert(row).select().single());
  } catch (e) {
    if (isUniqueViolation(e)) {
      const fallback = await unwrap<any>(
        db
          .from("sections")
          .select("*")
          .eq("name", row.name)
          .eq("education_level", row.education_level)
          .is("deleted_at", null)
          .maybeSingle(),
      );
      if (fallback) return fallback;
    }
    throw e;
  }
}

/**
 * Lists sections linked to a course via `course_sections`, annotated with `student_count`.
 * Simplest correct query: fetch enrolled student profiles for this course and count
 * matches where student profile `section` equals the section name.
 */
export async function listCourseSections(courseId: string) {
  const links = await unwrap<Array<{ section_id: string }>>(
    db.from("course_sections").select("section_id").eq("course_id", courseId),
  );
  if (!links.length) return [];

  const sectionIds = links.map((l) => l.section_id);
  const sections = await unwrap<any[]>(
    db.from("sections").select("*").in("id", sectionIds).is("deleted_at", null).order("name"),
  );

  const enrollments = await unwrap<Array<{ student_id: string }>>(
    db.from("enrollments").select("student_id").eq("course_id", courseId),
  );

  // Count student enrollments for sections.
  // We match by student profile section string (either name or id)
  const countsBySection = new Map<string, number>();
  if (enrollments.length > 0) {
    const studentIds = enrollments.map((e) => e.student_id);
    const profiles = await unwrap<Array<{ section: string | null }>>(
      db.from("profiles").select("section").in("id", studentIds).is("deleted_at", null),
    );
    for (const p of profiles) {
      if (p.section) {
        countsBySection.set(p.section, (countsBySection.get(p.section) ?? 0) + 1);
      }
    }
  }

  return sections.map((sec) => ({
    ...sec,
    student_count: countsBySection.get(sec.id) ?? countsBySection.get(sec.name) ?? 0,
  }));
}

export async function setCourseSections(courseId: string, sectionIds: string[]) {
  const existingLinks = await unwrap<Array<{ section_id: string }>>(
    db.from("course_sections").select("section_id").eq("course_id", courseId),
  );
  const existingIds = new Set(existingLinks.map((l) => l.section_id));
  const targetIds = new Set(sectionIds.filter((id) => typeof id === "string" && id.length > 0));

  const toRemove = [...existingIds].filter((id) => !targetIds.has(id));
  const toAdd = [...targetIds].filter((id) => !existingIds.has(id));

  if (toRemove.length > 0) {
    await unwrap(
      db.from("course_sections").delete().eq("course_id", courseId).in("section_id", toRemove),
    );
  }

  if (toAdd.length > 0) {
    await unwrap(
      db
        .from("course_sections")
        .insert(toAdd.map((section_id) => ({ course_id: courseId, section_id }))),
    );
  }
}

/**
 * Pure set-diff for enrollment: candidate ids not already present in `existing`.
 * Dedupes candidates and drops empty ids — order-preserving, DB-independent.
 */
export function missingEnrollments(existing: string[], candidates: string[]): string[] {
  const have = new Set(existing);
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const id of candidates) {
    if (!id || have.has(id) || seen.has(id)) continue;
    seen.add(id);
    missing.push(id);
  }
  return missing;
}

/**
 * Bulk section enrollment — enroll every active student whose profile section
 * matches the given sections into a course (one click for a whole cohort).
 * Idempotent: students already enrolled are skipped, so repeats are safe.
 * Profile `section` may hold either the section id or the section name —
 * same tolerance listCourseSections uses for counting.
 */
export async function enrollSectionStudents(
  courseId: string,
  sectionIds: string[],
): Promise<{ enrolled: number; candidates: number; sections: number }> {
  const targets = [...new Set(sectionIds)].filter((id) => typeof id === "string" && id.length > 0);
  if (!targets.length) return { enrolled: 0, candidates: 0, sections: 0 };

  const sections = await unwrap<Array<{ id: string; name: string }>>(
    db.from("sections").select("id, name").in("id", targets).is("deleted_at", null),
  );
  if (!sections.length) return { enrolled: 0, candidates: 0, sections: 0 };

  const matchTerms = new Set<string>();
  for (const s of sections) {
    matchTerms.add(s.id);
    matchTerms.add(s.name);
  }

  const students = await unwrap<Array<{ id: string }>>(
    db
      .from("profiles")
      .select("id")
      .eq("role", "student")
      .is("deleted_at", null)
      .in("section", [...matchTerms]),
  );
  const candidateIds = students.map((s) => s.id);
  if (!candidateIds.length) {
    return { enrolled: 0, candidates: 0, sections: sections.length };
  }

  const existing = await unwrap<Array<{ student_id: string }>>(
    db
      .from("enrollments")
      .select("student_id")
      .eq("course_id", courseId)
      .in("student_id", candidateIds),
  );
  const missing = missingEnrollments(
    existing.map((r) => r.student_id),
    candidateIds,
  );
  if (missing.length) {
    await unwrap(
      db
        .from("enrollments")
        .insert(missing.map((student_id) => ({ student_id, course_id: courseId }))),
    );
  }
  return { enrolled: missing.length, candidates: candidateIds.length, sections: sections.length };
}
