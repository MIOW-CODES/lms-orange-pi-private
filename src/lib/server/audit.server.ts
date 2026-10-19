// Server-side audit log — the authoritative record of privileged actions.
// Writes never throw: auditing must not break the action being audited.
import { db } from "@/integrations/db/client.server";
import { unwrap } from "@/lib/server/utils.server";

export interface AuditActor {
  id: string;
  full_name?: string | null;
  role: string;
}

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string;
  action: string;
  detail: string;
  created_at: string;
}

const MAX_DETAIL = 500;

/** Pure: clamp audit detail to a safe length. DB-independent for tests. */
export function clampAuditDetail(detail: string): string {
  const s = detail ?? "";
  return s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s;
}

/**
 * Append one audit row. `actor` may be null for system-triggered actions.
 * Failures are logged, never propagated — the audited action already happened.
 */
export async function writeAuditLog(
  actor: AuditActor | null,
  action: string,
  detail: string,
): Promise<void> {
  try {
    await unwrap(
      db.from("audit_logs").insert({
        actor_id: actor?.id ?? null,
        actor_name: actor?.full_name ?? null,
        actor_role: actor?.role ?? "system",
        action,
        detail: clampAuditDetail(detail),
      }),
    );
  } catch (e) {
    console.error("[audit] failed to write audit log:", e instanceof Error ? e.message : e);
  }
}

/** Newest-first audit listing for the staff audit trail UI. */
export async function listAuditLogs(limit = 200): Promise<AuditLogRow[]> {
  const capped = Math.min(Math.max(Math.trunc(limit) || 200, 1), 500);
  return unwrap<AuditLogRow[]>(
    db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(capped),
  );
}
