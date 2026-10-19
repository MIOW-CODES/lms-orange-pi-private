import { describe, expect, it } from "bun:test";
import { manilaDayCode, manilaMinutesOfDay } from "./attendance.server";

// Asia/Manila is UTC+8 with no DST. These helpers must agree regardless of the
// host process timezone (run under any TZ and the answers stay identical).
//
// Minutes-of-day are counted from Manila midnight: 08:30 Manila => 8*60+30 = 510.
// Reference weekdays: 2026-10-15 is a Thursday, 2026-10-16 is a Friday.

describe("manilaDayCode / manilaMinutesOfDay", () => {
  it("2026-10-16T00:30:00Z is Friday 08:30 Manila", () => {
    expect(manilaDayCode("2026-10-16T00:30:00Z")).toBe("fri");
    expect(manilaMinutesOfDay("2026-10-16T00:30:00Z")).toBe(510);
  });

  it("2026-10-15T23:59:00Z crosses the day boundary: Friday 07:59 Manila", () => {
    expect(manilaDayCode("2026-10-15T23:59:00Z")).toBe("fri");
    expect(manilaMinutesOfDay("2026-10-15T23:59:00Z")).toBe(479);
  });

  it("2026-10-15T15:59:00Z is still Thursday 23:59 Manila", () => {
    expect(manilaDayCode("2026-10-15T15:59:00Z")).toBe("thu");
    expect(manilaMinutesOfDay("2026-10-15T15:59:00Z")).toBe(1439);
  });

  it("2026-10-15T16:00:00Z is exactly Friday 00:00 Manila", () => {
    expect(manilaDayCode("2026-10-15T16:00:00Z")).toBe("fri");
    expect(manilaMinutesOfDay("2026-10-15T16:00:00Z")).toBe(0);
  });

  it("2026-10-14T02:00:00Z is Wednesday 10:00 Manila", () => {
    expect(manilaDayCode("2026-10-14T02:00:00Z")).toBe("wed");
    expect(manilaMinutesOfDay("2026-10-14T02:00:00Z")).toBe(600);
  });
});
