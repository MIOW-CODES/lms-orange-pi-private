/* eslint-disable @typescript-eslint/no-explicit-any */
// Course materials — upload, attach, remove + worksheet/assignment edits.
import { createHmac } from "node:crypto";
import { extname } from "node:path";
import { z } from "zod";
import { db, storage } from "@/integrations/db/client.server";
import { unwrap, withoutToken } from "@/lib/server/utils.server";
import { requireStaff, isEnrolledIn } from "@/lib/server/auth.server";
import { requireCourseOwnerOrAdmin } from "@/lib/server/courses.server";
import {
  isAssessmentEditable,
  isMaterialOpen,
  requireOpen,
  type AvailabilityRow,
} from "@/lib/server/availability";
import { sessionSecret } from "@/lib/server/sessions.server";

const MATERIAL_BUCKET = "course-materials";
const MATERIAL_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
};
const EXT_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".zip": "application/zip",
};
const MATERIAL_ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
]);
const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;

export type Attachment = { name: string; url: string; size: number; type: string; path: string };

export function materialUrlForPath(path: string): string {
  return `/api/public/material?p=${encodeURIComponent(path)}`;
}

function attachmentList(value: unknown): Attachment[] {
  return Array.isArray(value) ? (value as Attachment[]) : [];
}

async function removeMaterialObjects(items: Attachment[]) {
  const paths = items
    .map((a) => a.path)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (!paths.length) return;
  try {
    await storage.from(MATERIAL_BUCKET).remove(paths);
  } catch (e) {
    console.error("[materials]", e);
  }
}

async function detectMimeByMagic(buf: Buffer): Promise<string | null> {
  if (buf.length < 4) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
    return "application/pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07))
    return "application/zip";
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0)
    return "application/msword";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}

async function sniffMime(buffer: Buffer): Promise<string | null> {
  try {
    const mod: any = await import("file-type");
    const fn = mod.fileTypeFromBuffer ?? mod.fromBuffer ?? mod.default?.fileTypeFromBuffer;
    if (typeof fn === "function") {
      const ft = await fn(buffer);
      if (ft?.mime) return ft.mime as string;
    }
  } catch (e) {
    console.error("[materials]", e);
  }
  return detectMimeByMagic(buffer);
}

export async function uploadCourseMaterial(
  tokenStr: string,
  course_id: string,
  name: string,
  base64: string,
  content_type: string,
) {
  const caller = await requireCourseOwnerOrAdmin(tokenStr, course_id);
  if (!content_type || !MATERIAL_EXT[content_type]) {
    const fileExt = extname(name).toLowerCase();
    const inferred = EXT_TO_MIME[fileExt];
    if (inferred) content_type = inferred;
  }
  const ext = MATERIAL_EXT[content_type];
  if (!ext) throw new Error("Unsupported file type — use PDF, DOCX, PNG, JPG, or ZIP");
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) throw new Error("Empty file");
  if (buffer.byteLength > MAX_MATERIAL_BYTES) throw new Error("File must be under 25 MB");
  const sniffed = await sniffMime(buffer);
  if (!sniffed || !MATERIAL_ALLOWED_MIMES.has(sniffed)) {
    throw new Error(
      `Unsupported file content (${sniffed ?? "unknown"}) — use PDF, DOCX, PNG, JPG, or ZIP`,
    );
  }
  const zipFamily = new Set([
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]);
  const isZipSniff = sniffed === "application/zip";
  const isZipDeclared = zipFamily.has(content_type);
  if (sniffed !== content_type && !(isZipSniff && isZipDeclared)) {
    throw new Error(`MIME mismatch: declared ${content_type} but file is ${sniffed}`);
  }
  const rand = createHmac("sha256", sessionSecret())
    .update(`${caller.id}:${name}:${Date.now()}`)
    .digest("hex")
    .slice(0, 8);
  const path = `${course_id}/material_${Date.now()}_${rand}.${ext}`;
  const { error } = await storage
    .from(MATERIAL_BUCKET)
    .upload(path, buffer, { contentType: content_type, upsert: false });
  if (error) throw new Error(`Storage upload failed (${error.message})`);
  const attachment: Attachment = {
    name: name.slice(0, 200),
    url: materialUrlForPath(path),
    size: buffer.byteLength,
    type: content_type,
    path,
  };
  return attachment;
}

export async function removeCourseMaterial(
  tokenStr: string,
  target: "quiz" | "assignment",
  id: string,
  path: string,
) {
  const table = target === "quiz" ? "quizzes" : "assignments";
  // Dynamic import to avoid circular deps between quizzes/courses modules
  const { requireQuizOwnerOrAdmin } = await import("@/lib/server/quizzes.server");
  if (target === "quiz") await requireQuizOwnerOrAdmin(tokenStr, id);
  else await requireCourseOwnerOrAdmin(tokenStr, id);
  const row = await unwrap<any>(db.from(table).select("attachments").eq("id", id).maybeSingle());
  const items = attachmentList(row?.attachments);
  const keep = items.filter((a) => a.path !== path);
  const drop = items.filter((a) => a.path === path);
  await unwrap(db.from(table).update({ attachments: keep }).eq("id", id));
  await removeMaterialObjects(drop);
  return keep;
}

export async function attachCourseMaterial(
  tokenStr: string,
  target: "quiz" | "assignment",
  id: string,
  attachment: Attachment,
) {
  const table = target === "quiz" ? "quizzes" : "assignments";
  const { requireQuizOwnerOrAdmin } = await import("@/lib/server/quizzes.server");
  if (target === "quiz") await requireQuizOwnerOrAdmin(tokenStr, id);
  else await requireCourseOwnerOrAdmin(tokenStr, id);
  const row = await unwrap<any>(db.from(table).select("attachments").eq("id", id).maybeSingle());
  const next = [...attachmentList(row?.attachments), attachment];
  await unwrap(db.from(table).update({ attachments: next }).eq("id", id));
  return next;
}

/* ---------- Student submission files ---------- */

/**
 * Upload a file attached to a student's assignment submission.
 * Students may upload to their OWN submissions only; staff may upload on behalf.
 * Reuses the course-materials bucket under a `submissions/` prefix, records a
 * row in `submission_files`, and mirrors the metadata into
 * `submissions.file_urls` for fast reads.
 */
export async function uploadSubmissionFile(
  tokenStr: string,
  submissionId: string,
  name: string,
  base64: string,
  content_type: string,
): Promise<Attachment> {
  const { requireSelfOrStaff } = await import("@/lib/server/auth.server");
  const submission = await unwrap<{ id: string; student_id: string; assignment_id: string } | null>(
    db
      .from("submissions")
      .select("id, student_id, assignment_id")
      .eq("id", submissionId)
      .maybeSingle(),
  );
  if (!submission) throw new Error("Submission not found");
  const caller = await requireSelfOrStaff(tokenStr, submission.student_id);
  // Deadlines hard-block submissions — including late file attachments to an
  // existing submission (that would be a late-work write). Staff bypass.
  if (caller.role === "student") {
    const assignment = await unwrap<AvailabilityRow | null>(
      db
        .from("assignments")
        .select("opens_at, closes_at, due_date")
        .eq("id", submission.assignment_id)
        .maybeSingle(),
    );
    if (assignment) requireOpen(assignment, new Date());
  }

  if (!content_type || !MATERIAL_EXT[content_type]) {
    const fileExt = extname(name).toLowerCase();
    const inferred = EXT_TO_MIME[fileExt];
    if (inferred) content_type = inferred;
  }
  const ext = MATERIAL_EXT[content_type];
  if (!ext) throw new Error("Unsupported file type — use PDF, DOCX, PNG, JPG, or ZIP");
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) throw new Error("Empty file");
  if (buffer.byteLength > MAX_MATERIAL_BYTES) throw new Error("File must be under 25 MB");
  const sniffed = await sniffMime(buffer);
  if (!sniffed || !MATERIAL_ALLOWED_MIMES.has(sniffed)) {
    throw new Error(
      `Unsupported file content (${sniffed ?? "unknown"}) — use PDF, DOCX, PNG, JPG, or ZIP`,
    );
  }
  const zipFamily = new Set([
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]);
  const isZipSniff = sniffed === "application/zip";
  const isZipDeclared = zipFamily.has(content_type);
  if (sniffed !== content_type && !(isZipSniff && isZipDeclared)) {
    throw new Error(`MIME mismatch: declared ${content_type} but file is ${sniffed}`);
  }
  const rand = createHmac("sha256", sessionSecret())
    .update(`${submission.student_id}:${name}:${Date.now()}`)
    .digest("hex")
    .slice(0, 8);
  const path = `submissions/${submissionId}/file_${Date.now()}_${rand}.${ext}`;
  const { error } = await storage
    .from(MATERIAL_BUCKET)
    .upload(path, buffer, { contentType: content_type, upsert: false });
  if (error) throw new Error(`Storage upload failed (${error.message})`);

  const attachment: Attachment = {
    name: name.slice(0, 200),
    url: materialUrlForPath(path),
    size: buffer.byteLength,
    type: content_type,
    path,
  };
  await unwrap(
    db.from("submission_files").insert({
      submission_id: submissionId,
      file_url: attachment.url,
      file_name: attachment.name,
      mime: attachment.type,
    }),
  );
  // Mirror into submissions.file_urls (best-effort; tolerate missing column).
  try {
    const current = await unwrap<{ file_urls: unknown } | null>(
      db.from("submissions").select("file_urls").eq("id", submissionId).maybeSingle(),
    );
    const list = Array.isArray(current?.file_urls) ? (current!.file_urls as unknown[]) : [];
    await unwrap(
      db
        .from("submissions")
        .update({ file_urls: [...list, attachment] })
        .eq("id", submissionId),
    );
  } catch (e) {
    // The mirror into submissions.file_urls is best-effort (the canonical
    // record lives in submission_files), but log it so persistent failures
    // don't go unnoticed.
    console.error("[materials] failed to mirror submission file_urls:", e);
  }
  return attachment;
}

/** List file rows attached to a submission, oldest first. */
export async function listSubmissionFiles(submissionId: string) {
  return unwrap<
    Array<{
      id: string;
      submission_id: string;
      file_url: string;
      file_name: string;
      mime: string | null;
      created_at: string;
    }>
  >(
    db
      .from("submission_files")
      .select("id, submission_id, file_url, file_name, mime, created_at")
      .eq("submission_id", submissionId)
      .order("created_at"),
  );
}

export async function requireAssignmentOwnerOrAdmin(token: string, assignmentId: string) {
  const row = await unwrap<any>(
    db
      .from("assignments")
      .select("id, course_id, attachments")
      .eq("id", assignmentId)
      .maybeSingle(),
  );
  if (!row) throw new Error("Assignment not found");
  const caller = await requireCourseOwnerOrAdmin(token, row.course_id as string);
  return { caller, row };
}

const ALLOWED_ASSIGNMENT_COLUMNS = new Set([
  "title",
  "description",
  "course_id",
  "due_date",
  "total_points",
  "component_type",
  "score_released",
  "attachments",
  "opens_at",
  "closes_at",
  "deleted_at",
]);

export async function updateAssignment(
  tokenStr: string,
  id: string,
  patch: Record<string, unknown>,
) {
  const { row } = await requireAssignmentOwnerOrAdmin(tokenStr, id);
  if (row && !isAssessmentEditable(row, new Date())) {
    throw new Error(
      "This assignment is locked while its scheduled assessment window is active. Edits cannot be saved now.",
    );
  }
  const safePatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => ALLOWED_ASSIGNMENT_COLUMNS.has(key)),
  );
  if (Object.keys(safePatch).length)
    await unwrap(db.from("assignments").update(safePatch).eq("id", id));
}

export async function deleteAssignment(tokenStr: string, id: string, mode: "soft" | "hard") {
  const { row } = await requireAssignmentOwnerOrAdmin(tokenStr, id);
  if (row && !isAssessmentEditable(row, new Date())) {
    throw new Error(
      "This assignment is locked while its scheduled assessment window is active. It cannot be deleted now.",
    );
  }
  if (mode === "soft") {
    await unwrap(
      db.from("assignments").update({ deleted_at: new Date().toISOString() }).eq("id", id),
    );
    return { mode };
  }
  await unwrap(db.from("submissions").delete().eq("assignment_id", id));
  await unwrap(db.from("assignments").delete().eq("id", id));
  await removeMaterialObjects(attachmentList(row?.attachments));
  return { mode };
}

/* ---------- Edge-vision kiosk sync ---------- */

export async function hardwareRoster() {
  const rows = await unwrap<any[]>(
    db
      .from("profiles")
      .select("id, full_name, student_id, section, grade_level, role, rfid_uid, avatar_url")
      .is("deleted_at", null)
      .order("full_name"),
  );
  const users = (rows ?? [])
    .filter((p: any) => p.rfid_uid)
    .map((p: any) => ({
      user_id: p.id as string,
      full_name: p.full_name as string,
      student_no: (p.student_id ?? null) as string | null,
      section: (p.section ?? null) as string | null,
      grade_level: (p.grade_level ?? null) as number | null,
      role: p.role as string,
      rfid_uid: (p.rfid_uid ?? null) as string | null,
    }));
  return { synced_at: new Date().toISOString(), count: users.length, users };
}

// Tables with a soft-delete column — counts must never leak deleted rows.
// (Not every countable table has `deleted_at`; `courses`/`announcements` etc.
// are hard-deleted and are counted as-is.)
const SOFT_DELETE_TABLES = new Set(["profiles", "assignments", "quizzes"]);

export async function countRows(table: string): Promise<number> {
  let query = db.from(table).select("id");
  if (SOFT_DELETE_TABLES.has(table)) query = query.is("deleted_at", null);
  const rows = await unwrap<unknown[]>(query);
  return rows.length;
}

/* ---------- Material serving access policy (P2a, user-signed 2026-10-06) ----------
 * Announcement attachments (`<announcementId>/material_...`, same bucket/route):
 *   - any signed-in session may read them — announcements are already visible
 *     to every signed-in user, so their attachments follow suit;
 * Course-material paths (`<course_id>/material_...`):
 *   - staff (teacher/admin): always allowed;
 *   - students: must be enrolled in the course AND the path must be open under
 *     the materials-for-review policy — a file referenced by assessments is
 *     downloadable once ANY referencing active (non-deleted) assessment has
 *     opened and stays downloadable afterward ("any-open wins", no re-locking);
 *     a file referenced by no active assessment is course-level and opens with
 *     enrollment. No attempt-gating, ever.
 */

function attachmentsIncludePath(attachments: unknown, path: string): boolean {
  return Array.isArray(attachments) && attachments.some((a: any) => a?.path === path);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function canAccessCourseMaterialPath(
  caller: { id: string; role: string },
  path: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (caller.role === "admin" || caller.role === "teacher") return true;
  const courseId = path.split("/")[0] ?? "";
  // Announcement branch: `<announcementId>/…` paths belong to announcement
  // attachments, which every signed-in session may read. (Only probed for
  // well-formed uuids so the lookup can never error on cast.)
  if (UUID_RE.test(courseId)) {
    const announcement = await unwrap<{ id: string } | null>(
      db.from("announcements").select("id").eq("id", courseId).maybeSingle(),
    );
    if (announcement) return true;
  }
  if (!(await isEnrolledIn(caller.id, courseId))) return false;
  // Reverse lookup: which ACTIVE assessments in this course reference the path?
  const [quizzes, assignments] = await Promise.all([
    unwrap<Array<{ attachments: unknown } & AvailabilityRow>>(
      db
        .from("quizzes")
        .select("opens_at, closes_at, attachments")
        .eq("course_id", courseId)
        .is("deleted_at", null),
    ),
    unwrap<Array<{ attachments: unknown } & AvailabilityRow>>(
      db
        .from("assignments")
        .select("opens_at, closes_at, due_date, attachments")
        .eq("course_id", courseId)
        .is("deleted_at", null),
    ),
  ]);
  const referencing = [...quizzes, ...assignments].filter((row) =>
    attachmentsIncludePath(row.attachments, path),
  );
  return isMaterialOpen(referencing, now);
}
