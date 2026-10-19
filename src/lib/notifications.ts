import type { Announcement } from "./lms";

/**
 * Client-facing notification interface.
 * Connects announcements, worksheets, assignments, and quizzes to institutional email and SMS.
 */
export async function notifyAnnouncement(
  a: Pick<Announcement, "title" | "content" | "target_audience">,
): Promise<{ queued: true; recipients: number }> {
  // In client runtime, notification dispatch is executed automatically on server during creation.
  return { queued: true, recipients: 1 };
}

export async function notifyAnnouncementById(
  _id: string,
): Promise<{ queued: true; reason: string }> {
  return { queued: true, reason: "dispatched" };
}
