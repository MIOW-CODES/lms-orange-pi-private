// Server-side notification pipeline — dispatches alerts to institutional Gmail and SMS.
import { db } from "@/integrations/db/client.server";
import { unwrap } from "@/lib/server/utils.server";
import { type ProfileRow } from "@/lib/server/db-types";

export type NotificationChannel = "email" | "sms";
export type NotificationEventType =
  "announcement" | "assignment" | "worksheet" | "quiz" | "feedback";

export interface NotificationPayload {
  type: NotificationEventType;
  title: string;
  body: string;
  course_id?: string;
  target_audience?: string; // 'all' | 'students' | 'teachers' | 'grade_level:10' | etc.
  recipient_ids?: string[];
}

export interface NotificationDispatchResult {
  queued: boolean;
  total_recipients: number;
  email_sent: number;
  sms_sent: number;
  errors: string[];
}

/**
 * Log notification attempt to database for audit and transparency.
 */
async function logNotification(entry: {
  recipient_email?: string | null;
  recipient_phone?: string | null;
  channel: NotificationChannel;
  event_type: NotificationEventType;
  title: string;
  status: "sent" | "failed" | "mock";
  error?: string | null;
}) {
  try {
    await db.from("notification_logs").insert([
      {
        recipient_email: entry.recipient_email ?? null,
        recipient_phone: entry.recipient_phone ?? null,
        channel: entry.channel,
        event_type: entry.event_type,
        title: entry.title,
        status: entry.status,
        error: entry.error ?? null,
      },
    ]);
  } catch (err) {
    console.error("[notifications] Failed to log notification:", err);
  }
}

/**
 * Send an email via configured SMTP / Gmail API or mock mode.
 */
export async function sendEmailNotification(
  to: string,
  subject: string,
  content: string,
  eventType: NotificationEventType = "announcement",
): Promise<boolean> {
  const resendKey = process.env["RESEND_API_KEY"]?.trim();
  const mailFrom = process.env["MAIL_FROM"]?.trim() || process.env["RESEND_FROM"]?.trim();
  const mailEndpoint = process.env["SMTP_WEBHOOK_URL"]?.trim();

  if (process.env["NODE_ENV"] === "test" || ((!resendKey || !mailFrom) && !mailEndpoint)) {
    // Graceful mock mode in development / testing or when SMTP credentials are not yet set
    await logNotification({
      recipient_email: to,
      channel: "email",
      event_type: eventType,
      title: subject,
      status: "mock",
    });
    return true;
  }

  try {
    if (resendKey && mailFrom) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: mailFrom, to: [to], subject, text: content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Resend`);
    }
    // If external SMTP endpoint or webhook is specified:
    else if (mailEndpoint) {
      const res = await fetch(mailEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from mail endpoint`);
    }

    await logNotification({
      recipient_email: to,
      channel: "email",
      event_type: eventType,
      title: subject,
      status: "sent",
    });
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await logNotification({
      recipient_email: to,
      channel: "email",
      event_type: eventType,
      title: subject,
      status: "failed",
      error: message,
    });
    return false;
  }
}

/**
 * Send an SMS via Free SMS Gateway / Webhook / API.
 */
export async function sendSmsNotification(
  phone: string,
  text: string,
  eventType: NotificationEventType = "announcement",
): Promise<boolean> {
  const smsGatewayUrl = process.env["SMS_GATEWAY_URL"];
  const smsApiKey = process.env["SMS_API_KEY"];

  if (!smsGatewayUrl || process.env["NODE_ENV"] === "test") {
    // Graceful mock mode in development / test or without physical SMS gateway
    await logNotification({
      recipient_phone: phone,
      channel: "sms",
      event_type: eventType,
      title: text.slice(0, 50),
      status: "mock",
    });
    return true;
  }

  try {
    const res = await fetch(smsGatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(smsApiKey ? { Authorization: `Bearer ${smsApiKey}` } : {}),
      },
      body: JSON.stringify({
        to: phone,
        message: text,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} from SMS gateway`);

    await logNotification({
      recipient_phone: phone,
      channel: "sms",
      event_type: eventType,
      title: text.slice(0, 50),
      status: "sent",
    });
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await logNotification({
      recipient_phone: phone,
      channel: "sms",
      event_type: eventType,
      title: text.slice(0, 50),
      status: "failed",
      error: message,
    });
    return false;
  }
}

/**
 * Resolve recipients matching target audience or course enrollment.
 * Bounded by a hard timeout so an unreachable database degrades to an empty
 * recipient list instead of hanging the dispatch (and its tests) indefinitely.
 */
const RECIPIENT_RESOLVE_TIMEOUT_MS = 2_500;

export async function resolveNotificationRecipients(
  payload: NotificationPayload,
): Promise<ProfileRow[]> {
  try {
    return await Promise.race([
      resolveRecipientsUncapped(payload),
      new Promise<ProfileRow[]>((resolve) => {
        setTimeout(() => resolve([]), RECIPIENT_RESOLVE_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    // If DB is offline or in disconnected test environment, return empty list gracefully
    console.warn("[notifications] Recipient resolution fallback:", err);
    return [];
  }
}

async function resolveRecipientsUncapped(payload: NotificationPayload): Promise<ProfileRow[]> {
  if (payload.recipient_ids && payload.recipient_ids.length > 0) {
    const list = await unwrap<ProfileRow[]>(
      db.from("profiles").select("*").in("id", payload.recipient_ids).is("deleted_at", null),
    );
    return list;
  }

  if (payload.course_id) {
    // Query students enrolled in this course
    const enrollments = await unwrap<Array<{ student_id: string }>>(
      db.from("enrollments").select("student_id").eq("course_id", payload.course_id),
    );
    const ids = enrollments.map((e) => e.student_id);
    if (!ids.length) return [];
    return unwrap<ProfileRow[]>(
      db.from("profiles").select("*").in("id", ids).is("deleted_at", null),
    );
  }

  // Broad audience resolution (announcements)
  let query = db.from("profiles").select("*").is("deleted_at", null);
  if (payload.target_audience === "students") {
    query = query.eq("role", "student");
  } else if (payload.target_audience === "teachers") {
    query = query.eq("role", "teacher");
  } else if (payload.target_audience === "admins") {
    query = query.eq("role", "admin");
  }

  return await unwrap<ProfileRow[]>(query);
}

/**
 * Dispatch notification across channels (institutional Gmail & SMS).
 */
export async function dispatchNotification(
  payload: NotificationPayload,
): Promise<NotificationDispatchResult> {
  const recipients = await resolveNotificationRecipients(payload);
  const result: NotificationDispatchResult = {
    queued: true,
    total_recipients: recipients.length,
    email_sent: 0,
    sms_sent: 0,
    errors: [],
  };

  const formattedSms = `[MIOW] ${payload.title}: ${payload.body}`.slice(0, 160);

  for (const r of recipients) {
    if (r.email) {
      const emailOk = await sendEmailNotification(
        r.email,
        `[MIOW LMS] ${payload.title}`,
        payload.body,
        payload.type,
      );
      if (emailOk) result.email_sent++;
    }
    if (r.phone) {
      const smsOk = await sendSmsNotification(r.phone, formattedSms, payload.type);
      if (smsOk) result.sms_sent++;
    }
  }

  return result;
}
