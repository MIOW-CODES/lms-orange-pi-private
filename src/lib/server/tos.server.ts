/* eslint-disable @typescript-eslint/no-explicit-any */
// Table of Specifications (TOS) — one editable row per (course, quarter).
// `items` is a jsonb array of TosItem; asJsonParam serializes it for node-postgres.
import { db } from "@/integrations/db/client.server";
import { unwrap, asJsonParam } from "@/lib/server/utils.server";
import { requireStaff } from "@/lib/server/auth.server";
import { writeAuditLog } from "@/lib/server/audit.server";

/** Bloom's taxonomy levels allowed for a TOS item. */
export type CognitiveLevel =
  "remembering" | "understanding" | "applying" | "analyzing" | "evaluating" | "creating";

export interface TosItem {
  topic: string;
  no_of_items: number;
  cognitive_level: CognitiveLevel;
  /** Quiz this topic's items come from (null/omitted when not linked). */
  quiz_id?: string | null | undefined;
  note?: string | null | undefined;
}

export interface TosRow {
  id: string;
  course_id: string;
  quarter: number;
  title: string | null;
  items: TosItem[];
  created_at: string;
  updated_at: string;
}

export interface UpsertTosInput {
  id?: string | undefined;
  courseId: string;
  quarter: number;
  title?: string | null | undefined;
  items: TosItem[];
}

/** Normalize a stored items value (defensive: jsonb comes back parsed). */
function normalizeItems(items: unknown): TosItem[] {
  const raw = typeof items === "string" ? safeParse(items) : items;
  return Array.isArray(raw) ? (raw as TosItem[]) : [];
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

/** All TOS rows for a course, ordered by quarter. */
export async function listTosForCourse(courseId: string): Promise<TosRow[]> {
  const rows = await unwrap<any[]>(
    db.from("tos").select("*").eq("course_id", courseId).order("quarter", { ascending: true }),
  );
  return rows.map((r) => ({ ...(r as TosRow), items: normalizeItems(r.items) }));
}

/**
 * Create or update one TOS row. Upserts on (course_id, quarter) when no id is
 * given; `items` replaces the stored item set wholesale (item deletion is just
 * an upsert without that item). Staff-only; writes an audit entry.
 */
export async function upsertTos(token: string, input: UpsertTosInput): Promise<TosRow> {
  const caller = await requireStaff(token);

  const existing = input.id
    ? await unwrap<any>(
        db.from("tos").select("id, course_id, quarter").eq("id", input.id).maybeSingle(),
      )
    : await unwrap<any>(
        db
          .from("tos")
          .select("id, course_id, quarter")
          .eq("course_id", input.courseId)
          .eq("quarter", input.quarter)
          .maybeSingle(),
      );

  const row: Record<string, any> = {
    course_id: input.courseId,
    quarter: input.quarter,
    title: input.title ?? null,
    items: asJsonParam(input.items ?? []),
    updated_at: new Date().toISOString(),
  };

  let id: string;
  if (existing) {
    id = existing.id as string;
    await unwrap(db.from("tos").update(row).eq("id", id));
  } else {
    const inserted = await unwrap<any>(db.from("tos").insert(row).single());
    id = inserted.id as string;
  }

  const saved = await unwrap<any>(db.from("tos").select("*").eq("id", id).maybeSingle());
  await writeAuditLog(
    caller,
    "TOS saved",
    `Course ${input.courseId} · Q${input.quarter} · ${(input.items ?? []).length} items`,
  );
  return { ...(saved as TosRow), items: normalizeItems(saved?.items) };
}

/** Delete a whole TOS row. Staff-only; writes an audit entry. */
export async function deleteTos(token: string, id: string): Promise<void> {
  const caller = await requireStaff(token);
  await unwrap(db.from("tos").delete().eq("id", id));
  await writeAuditLog(caller, "TOS deleted", `TOS ${id}`);
}
