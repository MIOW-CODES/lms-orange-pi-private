import { z } from "zod";
import { db } from "@/integrations/db/client.server";
import { requireAdmin, requireSession } from "@/lib/server/auth.server";
import { schemas } from "@/lib/server/schemas.server";
import { unwrap } from "@/lib/server/utils.server";
import { dispatchNotification } from "@/lib/server/notifications.server";

export type FeedbackReport = {
  id: string;
  reporter_id: string;
  reporter_name: string | null;
  reporter_role: "student" | "teacher" | "admin" | null;
  reporter_email: string | null;
  category: "bug" | "issue" | "feedback" | "course_content" | "other";
  subject: string;
  description: string;
  page_url: string | null;
  status: "open" | "in_review" | "resolved" | "closed";
  admin_note: string | null;
  created_at: string;
  updated_at: string;
};

const REPORT_COLUMNS =
  "id, reporter_id, category, subject, description, page_url, status, admin_note, created_at, updated_at";

function withReporter(rows: Array<Record<string, unknown>>): FeedbackReport[] {
  return rows.map((row) => {
    const reporterValue = row["reporter"];
    const reporter = (Array.isArray(reporterValue) ? reporterValue[0] : reporterValue) as
      | { full_name?: string; role?: FeedbackReport["reporter_role"]; email?: string | null }
      | null
      | undefined;
    return {
      ...(row as FeedbackReport),
      reporter_name: reporter?.full_name ?? null,
      reporter_role: reporter?.role ?? null,
      reporter_email: reporter?.email ?? null,
    };
  });
}

export async function listFeedbackReports(token: string): Promise<FeedbackReport[]> {
  const caller = await requireSession(token);
  const query = db
    .from("feedback_reports")
    .select(
      `${REPORT_COLUMNS}, reporter:profiles!feedback_reports_reporter_id_fkey(full_name, role, email)`,
    )
    .order("created_at", { ascending: false });
  const rows =
    caller.role === "admin"
      ? await unwrap<Array<Record<string, unknown>>>(query)
      : await unwrap<Array<Record<string, unknown>>>(query.eq("reporter_id", caller.id));
  return withReporter(rows);
}

export async function createFeedbackReport(
  token: string,
  input: z.infer<typeof schemas.feedbackReportInput>,
): Promise<FeedbackReport> {
  const caller = await requireSession(token);
  const row = await unwrap<Record<string, unknown>>(
    db
      .from("feedback_reports")
      .insert({
        reporter_id: caller.id,
        category: input.category,
        subject: input.subject.trim(),
        description: input.description.trim(),
        page_url: input.page_url ?? null,
      })
      .select(
        `${REPORT_COLUMNS}, reporter:profiles!feedback_reports_reporter_id_fkey(full_name, role, email)`,
      )
      .single(),
  );
  await dispatchNotification({
    type: "feedback",
    title: `New issue report: ${input.subject.trim()}`,
    body: `${input.category}: ${input.description.trim()}\nReported by: ${caller.email ?? caller.id}`,
    target_audience: "admins",
  }).catch((err) => {
    console.error("[feedback] Failed to dispatch notification:", err);
    return null;
  });
  return withReporter([row])[0]!;
}

export async function updateFeedbackReport(
  token: string,
  id: string,
  patch: z.infer<typeof schemas.feedbackReportPatch>["patch"],
): Promise<void> {
  await requireAdmin(token);
  await unwrap(
    db
      .from("feedback_reports")
      .update({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.admin_note !== undefined ? { admin_note: patch.admin_note } : {}),
        updated_at: new Date().toISOString(),
        ...(patch.status === "resolved" || patch.status === "closed"
          ? { resolved_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", id),
  );
}
