import { describe, it, expect } from "bun:test";
import {
  dispatchNotification,
  sendEmailNotification,
  sendSmsNotification,
} from "./notifications.server";

describe("notifications.server", () => {
  it("sendEmailNotification logs and returns true in mock/test mode", async () => {
    const ok = await sendEmailNotification(
      "student@ids.msuiit.edu.ph",
      "Welcome to MIOW",
      "Course orientation starts today.",
    );
    expect(ok).toBe(true);
  });

  it("sendSmsNotification logs and returns true in mock/test mode", async () => {
    const ok = await sendSmsNotification("+639171234567", "New assignment posted in ICT 1.");
    expect(ok).toBe(true);
  });

  it("dispatchNotification handles broad announcements without throwing", async () => {
    const res = await dispatchNotification({
      type: "announcement",
      title: "Exam Schedule",
      body: "Midterm examinations will take place next week.",
      target_audience: "all",
    });
    expect(res.queued).toBe(true);
    expect(res.errors.length).toBe(0);
  });
});
