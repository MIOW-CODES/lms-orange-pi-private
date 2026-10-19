import { describe, it, expect } from "bun:test";
import { PREFIXES } from "./course-levels";

describe("Field and Toggle shared components", () => {
  it("PREFIXES is exported from course-levels", () => {
    expect(Array.isArray(PREFIXES)).toBe(true);
    expect(PREFIXES).toEqual(["", "Dr.", "Prof.", "Mr.", "Ms.", "Mrs.", "Engr."]);
  });
});

describe("notifications stub", () => {
  it("notifyAnnouncement returns queued status", async () => {
    const { notifyAnnouncement } = await import("./notifications");
    const result = await notifyAnnouncement({
      title: "Test",
      content: "Body",
      target_audience: "all",
    });
    expect(result.queued).toBe(true);
  });

  it("notifyAnnouncementById returns queued status", async () => {
    const { notifyAnnouncementById } = await import("./notifications");
    const result = await notifyAnnouncementById("test-id");
    expect(result.queued).toBe(true);
  });
});
