/* eslint-disable @typescript-eslint/no-explicit-any */
// Auth guards — session resolution with role checks.
import { db } from "@/integrations/db/client.server";
import { unwrap } from "@/lib/server/utils.server";
import { verifySessionToken, sessionJti } from "@/lib/server/sessions.server";
import { getProfileById } from "@/lib/server/profiles.server";
import { getCookie } from "@tanstack/react-start/server";
import { COOKIE_SESSION_MARKER } from "@/lib/session";

export const SESSION_COOKIE_NAME =
  process.env["NODE_ENV"] === "production" ? "__Host-miow_session" : "miow_session";

export function resolveSessionToken(token: string): string {
  const resolved = token === COOKIE_SESSION_MARKER ? getCookie(SESSION_COOKIE_NAME) : token;
  if (!resolved) throw new Error("Unauthorized");
  return resolved;
}

/** Verify the caller's signed token and confirm its JTI remains active. */
export async function requireSession(token: string, options: { allowTemporaryPin?: boolean } = {}) {
  token = resolveSessionToken(token);
  const id = verifySessionToken(token);
  const jti = sessionJti(token);
  if (!jti) throw new Error("Unauthorized");
  try {
    const row = await unwrap<{ revoked_at: string | null } | null>(
      db.from("sessions").select("revoked_at").eq("jti", jti).maybeSingle(),
    );
    if (!row || row.revoked_at) throw new Error("Unauthorized");
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") throw error;
    console.error("[auth] JTI revocation check failed");
    throw new Error("Unauthorized");
  }
  const profile = await getProfileById(id);
  if (!profile) throw new Error("Unauthorized");
  if (profile.pin_must_change && !options.allowTemporaryPin)
    throw new Error("Choose a new PIN before continuing.");
  return profile;
}

/** Caller must be a teacher or admin. */
export async function requireStaff(token: string) {
  const profile = await requireSession(token);
  if (profile.role === "student") throw new Error("Forbidden");
  return profile;
}

/** Caller must be an admin. */
export async function requireAdmin(token: string) {
  const profile = await requireSession(token);
  if (profile.role !== "admin") throw new Error("Forbidden");
  return profile;
}

/** Caller must be a teacher. Students and administrators are rejected. */
export async function requireTeacher(token: string) {
  const profile = await requireSession(token);
  if (profile.role !== "teacher") throw new Error("Forbidden");
  return profile;
}

/** Caller must be the given student, or staff. */
export async function requireSelfOrStaff(token: string, studentId: string) {
  const profile = await requireSession(token);
  if (profile.role === "student" && profile.id !== studentId) throw new Error("Forbidden");
  return profile;
}

/* ---------- Course-membership guards (Gate-1 amendment #3) ---------- */

/** Course ids the student is enrolled in. */
export async function enrolledCourseIds(studentId: string): Promise<string[]> {
  const rows = await unwrap<Array<{ course_id: string }>>(
    db.from("enrollments").select("course_id").eq("student_id", studentId),
  );
  return rows.map((r) => r.course_id);
}

/** True when the student is enrolled in the course. */
export async function isEnrolledIn(studentId: string, courseId: string): Promise<boolean> {
  const row = await unwrap<{ course_id: string } | null>(
    db
      .from("enrollments")
      .select("course_id")
      .eq("student_id", studentId)
      .eq("course_id", courseId)
      .maybeSingle(),
  );
  return !!row;
}

/**
 * Course-content guard: staff (teacher/admin) see everything; students must be
 * enrolled in the course. Throws "Forbidden" otherwise. Doubles as the C13
 * centralization seam alongside availability.requireOpen.
 */
export async function requireEnrollment(
  courseId: string,
  profile: { id: string; role: string },
): Promise<void> {
  if (profile.role !== "student") return;
  if (!(await isEnrolledIn(profile.id, courseId))) {
    throw new Error("Forbidden: you are not enrolled in this course.");
  }
}
