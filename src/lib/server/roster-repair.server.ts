// One-time roster repair for the TVE100 (Section B8) college roster.
//
// The 48 students imported by `20260923000001_seed_tve100_roster.sql` arrived
// with no email and no PIN, so their first sign-ins all failed. After five
// failures the login lockout (5 attempts / 15 minutes) additionally blocked
// them — the "invalid because they exceeded the 5 limit attempts" report.
//
// This mirrors `20260924000003_restore_tve100_access.sql` using the runtime DB
// client so it can be applied to a managed backend where raw SQL is not
// available. It:
//   * clears `failed_login_attempts` / `locked_until`,
//   * re-asserts email + PIN (PIN = student_id, bcrypt-hashed) without
//     overwriting credentials that already exist,
//   * re-enrolls every B8 student into TVE100.
//
// Idempotent: safe to run repeatedly.

import bcrypt from "bcryptjs";
import { db } from "@/integrations/db/client.server";

const SECTION = "B8";
const COURSE_CODE = "TVE100";

type RosterRow = {
  id: string;
  student_id: string | null;
  full_name: string;
  email: string | null;
  pin: string | null;
  pin_hash: string | null;
};

// Lowercase + strip diacritics + keep only [a-z0-9]. Matches the SQL helper
// `private.miow_slug` used by the credentials migration.
function slug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export type RosterRepairSummary = {
  section: string;
  course: string;
  courseId: string | null;
  students: number;
  credentialsUpdated: number;
  locksCleared: number;
  enrollmentsAdded: number;
  skipped: Array<{ student_id: string | null; reason: string }>;
};

export async function repairTve100Roster(): Promise<RosterRepairSummary> {
  const skipped: Array<{ student_id: string | null; reason: string }> = [];

  const { data, error } = await db
    .from("profiles")
    .select("id, student_id, full_name, email, pin, pin_hash")
    .eq("role", "student")
    .eq("section", SECTION)
    .is("deleted_at", null);
  if (error) throw new Error(`profiles read failed: ${error.message}`);

  const roster = (data ?? []) as RosterRow[];

  // Derive the institutional email parts and rank same-name students so the
  // generated addresses match the migration's deterministic scheme.
  const prepared: Array<RosterRow & { first: string; last: string }> = [];
  for (const row of roster) {
    const name = row.full_name ?? "";
    const comma = name.indexOf(",");
    if (comma <= 0) {
      skipped.push({ student_id: row.student_id, reason: "name has no comma" });
      continue;
    }
    if (!row.student_id || !row.student_id.trim()) {
      skipped.push({ student_id: row.student_id, reason: "missing student_id" });
      continue;
    }
    const last = slug(name.slice(0, comma).trim());
    const firstRaw = name
      .slice(comma + 1)
      .trim()
      .replace(/\s+[A-Za-z]\.?\s*$/, "");
    const first = slug(firstRaw);
    if (!first || !last) {
      skipped.push({ student_id: row.student_id, reason: "unusable name" });
      continue;
    }
    prepared.push({ ...row, first, last });
  }

  const ordered = [...prepared].sort((a, b) =>
    (a.student_id ?? "").localeCompare(b.student_id ?? ""),
  );
  const totals = new Map<string, number>();
  for (const p of ordered) {
    const key = `${p.first}.${p.last}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();

  let credentialsUpdated = 0;

  for (const p of ordered) {
    const key = `${p.first}.${p.last}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const suffix = (totals.get(key) ?? 1) > 1 ? String(n) : "";
    const derivedEmail = `${p.first}.${p.last}${suffix}@g.msuiit.edu.ph`;

    const email = p.email?.trim() ? p.email : derivedEmail;
    const pin = p.pin?.trim() ? p.pin : p.student_id!;
    const pinHash = p.pin_hash?.trim() ? p.pin_hash : await bcrypt.hash(p.student_id!, 10);

    const patch: Record<string, unknown> = {
      email,
      pin,
      pin_hash: pinHash,
      failed_login_attempts: 0,
      locked_until: null,
    };
    const { error: upErr } = await db.from("profiles").update(patch).eq("id", p.id);
    if (upErr) {
      skipped.push({ student_id: p.student_id, reason: `update failed: ${upErr.message}` });
      continue;
    }
    credentialsUpdated += 1;
  }

  // Resolve the TVE100 course id and re-assert enrollment for every student.
  const { data: course, error: courseErr } = await db
    .from("courses")
    .select("id")
    .eq("code", COURSE_CODE)
    .maybeSingle();
  if (courseErr) throw new Error(`course lookup failed: ${courseErr.message}`);

  const courseId = (course as { id: string } | null)?.id ?? null;
  let enrollmentsAdded = 0;
  if (courseId) {
    for (const row of roster) {
      const { error: enrErr } = await db
        .from("enrollments")
        .upsert(
          { student_id: row.id, course_id: courseId },
          { onConflict: "student_id,course_id", ignoreDuplicates: true },
        );
      if (enrErr) {
        skipped.push({ student_id: row.student_id, reason: `enroll failed: ${enrErr.message}` });
      } else {
        enrollmentsAdded += 1;
      }
    }
  }

  return {
    section: SECTION,
    course: COURSE_CODE,
    courseId,
    students: roster.length,
    credentialsUpdated,
    locksCleared: credentialsUpdated,
    enrollmentsAdded,
    skipped,
  };
}
