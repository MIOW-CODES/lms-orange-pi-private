/* eslint-disable @typescript-eslint/no-explicit-any */
// Attendance — logging, tap status engine, schedule-aware status.
import { db } from "@/integrations/db/client.server";
import { unwrap } from "@/lib/server/utils.server";
import { listCourses, enrollmentsForStudent } from "@/lib/server/courses.server";
import { safeProfile } from "@/lib/server/profiles.server";

export async function listAttendance(studentId: string) {
  return unwrap<any[]>(
    db
      .from("attendance_logs")
      .select("*")
      .eq("student_id", studentId)
      .order("timestamp", { ascending: false }),
  );
}

export async function listAllAttendance(limit: number) {
  return unwrap<any[]>(
    db.from("attendance_logs").select("*").order("timestamp", { ascending: false }).limit(limit),
  );
}

export async function logAttendance(
  student_id: string,
  scan_type: "in" | "out",
  status: "on-time" | "late" | "excused",
  timestamp?: string | undefined,
  course_id?: string | null | undefined,
) {
  await unwrap(
    db.from("attendance_logs").insert({
      student_id,
      scan_type,
      status,
      timestamp: timestamp ?? new Date().toISOString(),
      course_id: course_id ?? null,
    }),
  );
}

export async function bulkLogAttendance(
  items: Array<{
    student_id: string;
    scan_type: "in" | "out";
    status: "on-time" | "late" | "excused";
    timestamp?: string | undefined;
    course_id?: string | null | undefined;
  }>,
) {
  if (!items.length) return { count: 0 };
  const rows = items.map((item) => ({
    student_id: item.student_id,
    scan_type: item.scan_type,
    status: item.status,
    timestamp: item.timestamp ?? new Date().toISOString(),
    course_id: item.course_id ?? null,
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    await unwrap(db.from("attendance_logs").insert(batch));
  }
  return { count: rows.length };
}

/* ---------- Tap status engine (schedule-aware) ---------- */

const DAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
};

/** Asia/Manila is UTC+8 year-round (no DST). All schedule evaluation is done on
 * the UTC instant shifted by this offset so the host process TZ never matters. */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Day-of-week code ("sun".."sat") of an ISO instant as seen in Asia/Manila.
 * Pure: derived from the UTC instant, independent of the process timezone. */
export function manilaDayCode(atISO: string): string {
  const shifted = new Date(new Date(atISO).getTime() + MANILA_OFFSET_MS);
  return DAY_CODES[shifted.getUTCDay()]!;
}

/** Minutes since Asia/Manila midnight (0–1439) of an ISO instant.
 * Pure: derived from the UTC instant, independent of the process timezone. */
export function manilaMinutesOfDay(atISO: string): number {
  const shifted = new Date(new Date(atISO).getTime() + MANILA_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** Start (00:00 Asia/Manila) of the Manila calendar day containing `at`,
 * as a fresh Date. Pure: never mutates the input. */
function manilaDayStart(at: Date): Date {
  const shifted = new Date(at.getTime() + MANILA_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      MANILA_OFFSET_MS,
  );
}

export async function recordTap(uid: string, atISO?: string) {
  const raw = await unwrap<any>(
    db.from("profiles").select("*").eq("rfid_uid", uid).is("deleted_at", null).maybeSingle(),
  );
  if (!raw) return null;
  return recordTapForProfile(raw, atISO);
}

export async function recordTapByProfileId(id: string, atISO?: string) {
  const raw = await unwrap<any>(
    db.from("profiles").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
  );
  if (!raw) return null;
  return recordTapForProfile(raw, atISO);
}

async function recordTapForProfile(raw: any, atISO?: string) {
  const parsed = atISO ? new Date(atISO) : new Date();
  const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  // Manila-local midnight of the tap's day — deterministic regardless of the
  // server process timezone (Manila has no DST, fixed UTC+8).
  const dayStart = manilaDayStart(at);

  // Match course schedule first so in/out toggling is course-scoped
  const courses = await listCourses({ id: raw.id, role: raw.role });
  const enrolled = raw.role === "student" ? new Set(await enrollmentsForStudent(raw.id)) : null;
  const today = manilaDayCode(at.toISOString());
  const atMin = manilaMinutesOfDay(at.toISOString());
  const sessions = courses.filter(
    (c: any) =>
      Array.isArray(c.days_of_week) &&
      c.days_of_week.includes(today) &&
      c.start_time &&
      c.end_time &&
      (enrolled ? enrolled.has(c.id) : c.teacher_id === raw.id),
  );

  let matched: any = null;
  let status: "on-time" | "late" = "on-time";

  if (sessions.length > 0) {
    const inWindow = sessions.find(
      (c: any) => atMin >= toMinutes(c.start_time) - 30 && atMin <= toMinutes(c.end_time),
    );
    matched =
      inWindow ??
      sessions.reduce((best: any, c: any) =>
        Math.abs(toMinutes(c.start_time) - atMin) < Math.abs(toMinutes(best.start_time) - atMin)
          ? c
          : best,
      );
    const grace = matched.late_threshold_minutes ?? 10;
    status = atMin <= toMinutes(matched.start_time) + grace ? "on-time" : "late";
  } else {
    status = atMin <= 7 * 60 + 30 + 10 ? "on-time" : "late";
  }

  // Course-scoped toggle: check last log today for this student and matched course (or null)
  let query = db
    .from("attendance_logs")
    .select("scan_type, timestamp")
    .eq("student_id", raw.id)
    .gte("timestamp", dayStart.toISOString());

  if (matched?.id) {
    query = query.eq("course_id", matched.id);
  } else {
    query = query.is("course_id", null);
  }

  const lastToday = await unwrap<Array<{ scan_type: string; timestamp: string }>>(
    query.order("timestamp", { ascending: false }).limit(1),
  );

  // Debounce rapid double-taps within 5 seconds for the same scope
  if (lastToday[0]?.timestamp) {
    const elapsedMs = at.getTime() - new Date(lastToday[0].timestamp).getTime();
    if (elapsedMs >= 0 && elapsedMs < 5000) {
      return {
        profile: safeProfile(raw),
        scan_type: lastToday[0].scan_type as "in" | "out",
        status,
        course: matched
          ? {
              id: matched.id as string,
              code: matched.code as string,
              title: matched.title as string,
              start_time: matched.start_time as string,
              end_time: matched.end_time as string,
              late_threshold_minutes: matched.late_threshold_minutes as number,
            }
          : null,
        at: at.toISOString(),
      };
    }
  }

  const scan_type: "in" | "out" = lastToday[0]?.scan_type === "in" ? "out" : "in";

  await unwrap(
    db.from("attendance_logs").insert({
      student_id: raw.id,
      course_id: matched?.id ?? null,
      scan_type,
      status,
      timestamp: at.toISOString(),
    }),
  );
  return {
    profile: safeProfile(raw),
    scan_type,
    status,
    course: matched
      ? {
          id: matched.id as string,
          code: matched.code as string,
          title: matched.title as string,
          start_time: matched.start_time as string,
          end_time: matched.end_time as string,
          late_threshold_minutes: matched.late_threshold_minutes as number,
        }
      : null,
    at: at.toISOString(),
  };
}

export async function updateAttendanceLog(id: string, patch: Record<string, unknown>) {
  await unwrap(db.from("attendance_logs").update(patch).eq("id", id));
}

export async function deleteAttendanceLog(id: string) {
  await unwrap(db.from("attendance_logs").delete().eq("id", id));
}
