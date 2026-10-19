/* eslint-disable @typescript-eslint/no-explicit-any */
// Course meetings (lecture and lab timetable slots) and memberships.
import { z } from "zod";
import { db } from "@/integrations/db/client.server";
import { unwrap, withoutToken } from "@/lib/server/utils.server";
import { requireStaff } from "@/lib/server/auth.server";
import { schemas } from "@/lib/server/schemas.server";

function parseTimeToSeconds(t: string): number {
  const [h = 0, m = 0, s = 0] = t.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

export async function listCourseMeetings(courseId: string) {
  return unwrap<any[]>(
    db
      .from("course_meetings")
      .select("*")
      .eq("course_id", courseId)
      .order("sort_order")
      .order("start_time"),
  );
}

export async function upsertCourseMeeting(input: z.infer<typeof schemas.courseMeeting>) {
  if (parseTimeToSeconds(input.end_time) <= parseTimeToSeconds(input.start_time)) {
    throw new Error("Invalid meeting times: end_time must be after start_time");
  }

  const caller = await requireStaff(input.token);
  if (caller.role === "teacher") {
    const course = await unwrap<{ teacher_id: string | null } | null>(
      db.from("courses").select("teacher_id").eq("id", input.course_id).maybeSingle(),
    );
    if (!course || course.teacher_id !== caller.id) {
      throw new Error("Forbidden: you can only edit courses you lead.");
    }
    if (input.id) {
      const existing = await unwrap<{ course_id: string } | null>(
        db.from("course_meetings").select("course_id").eq("id", input.id).maybeSingle(),
      );
      if (!existing || existing.course_id !== input.course_id) {
        throw new Error("Forbidden: meeting does not belong to the specified course.");
      }
    }
  }

  const row = withoutToken(input);
  if (input.id) {
    return unwrap<any>(db.from("course_meetings").update(row).eq("id", input.id).select().single());
  } else {
    return unwrap<any>(db.from("course_meetings").insert(row).select().single());
  }
}

export async function deleteCourseMeeting(id: string, token?: string) {
  if (token) {
    const meeting = await unwrap<{ course_id: string } | null>(
      db.from("course_meetings").select("course_id").eq("id", id).maybeSingle(),
    );
    if (meeting) {
      const caller = await requireStaff(token);
      if (caller.role === "teacher") {
        const course = await unwrap<{ teacher_id: string | null } | null>(
          db.from("courses").select("teacher_id").eq("id", meeting.course_id).maybeSingle(),
        );
        if (!course || course.teacher_id !== caller.id) {
          throw new Error("Forbidden: you can only edit courses you lead.");
        }
      }
    }
  }
  await unwrap(db.from("course_meetings").delete().eq("id", id));
}

export async function setMeetingMembers(meetingId: string, studentIds: string[], token?: string) {
  if (token) {
    const meeting = await unwrap<{ course_id: string } | null>(
      db.from("course_meetings").select("course_id").eq("id", meetingId).maybeSingle(),
    );
    if (!meeting) throw new Error("Course meeting not found");
    const caller = await requireStaff(token);
    if (caller.role === "teacher") {
      const course = await unwrap<{ teacher_id: string | null } | null>(
        db.from("courses").select("teacher_id").eq("id", meeting.course_id).maybeSingle(),
      );
      if (!course || course.teacher_id !== caller.id) {
        throw new Error("Forbidden: you can only edit courses you lead.");
      }
    }
  }

  const ids = [...new Set(studentIds)].filter((id) => typeof id === "string" && id.length > 0);
  await unwrap(db.from("course_meeting_members").delete().eq("meeting_id", meetingId));
  if (ids.length) {
    await unwrap(
      db
        .from("course_meeting_members")
        .insert(ids.map((student_id) => ({ meeting_id: meetingId, student_id }))),
    );
  }
}

export async function listMeetingMembers(meetingId: string): Promise<string[]> {
  const rows = await unwrap<Array<{ student_id: string }>>(
    db.from("course_meeting_members").select("student_id").eq("meeting_id", meetingId),
  );
  return rows.map((r) => r.student_id);
}

/**
 * Append students to a meeting WITHOUT touching the existing roster — the
 * bulk-add flow uses this so importing a class list can never clobber a
 * membership list somebody else is editing at the same time. Authorization is
 * the caller's job (bulk import authorizes on the meeting's course first).
 */
export async function addMeetingMembers(
  meetingId: string,
  studentIds: string[],
): Promise<{ added: number }> {
  const ids = [...new Set(studentIds)].filter((id) => typeof id === "string" && id.length > 0);
  if (!ids.length) return { added: 0 };
  const existing = await unwrap<Array<{ student_id: string }>>(
    db
      .from("course_meeting_members")
      .select("student_id")
      .eq("meeting_id", meetingId)
      .in("student_id", ids),
  );
  const have = new Set(existing.map((r) => r.student_id));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length) {
    await unwrap(
      db
        .from("course_meeting_members")
        .insert(missing.map((student_id) => ({ meeting_id: meetingId, student_id }))),
    );
  }
  return { added: missing.length };
}
