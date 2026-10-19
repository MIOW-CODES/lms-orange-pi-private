import { describe, expect, it } from "bun:test";
import { parseGradebookSpreadsheet } from "./gradebook-import";
import type { Profile } from "./lms";
import * as XLSX from "xlsx";

const mockRoster: Profile[] = [
  {
    id: "p1",
    student_id: "2024-0001",
    email: "juan.delacruz@g.msuiit.edu.ph",
    full_name: "Juan Dela Cruz",
    role: "student",
    section: "Ruby",
    rfid_uid: "1001",
    avatar_url: null,
    grade_level: 10,
    created_at: "2026-01-01",
  },
  {
    id: "p2",
    student_id: "2024-0002",
    email: "maria.santos@g.msuiit.edu.ph",
    full_name: "Maria Santos",
    role: "student",
    section: "Diamond",
    rfid_uid: "1002",
    avatar_url: null,
    grade_level: 10,
    created_at: "2026-01-01",
  },
];

describe("parseGradebookSpreadsheet", () => {
  it("parses CSV content with standard headers and matches students by ID", () => {
    const csv = `Student No,Name,Section,WW (20%),PT (40%),Exam (30%),Notes
2024-0001,Juan Dela Cruz,Ruby,88,92,85,Lab done
2024-0002,Maria Santos,Diamond,90,95,91,`;

    const res = parseGradebookSpreadsheet(
      csv,
      "grades.csv",
      mockRoster,
      {},
      {},
      () => 100,
      "overwrite",
    );

    expect(res.totalRows).toBe(2);
    expect(res.matchedCount).toBe(2);
    expect(res.changedCount).toBe(2);
    expect(res.unmatchedCount).toBe(0);
    expect(res.invalidCount).toBe(0);

    const juan = res.rows.find((r) => r.student?.id === "p1");
    expect(juan).toBeDefined();
    expect(juan?.parsedWw).toBe(88);
    expect(juan?.parsedPt).toBe(92);
    expect(juan?.parsedEx).toBe(85);
    expect(juan?.overrideNote).toBe("Lab done");
    expect(juan?.preview?.transmuted).toBeGreaterThan(80);
  });

  it("handles XLSX binary data cleanly", () => {
    const data = [
      ["Student ID", "Full Name", "WW", "PT", "Periodical Exam"],
      ["2024-0001", "Juan Dela Cruz", 75, 80, 85],
      ["2024-0002", "Maria Santos", 95, 92, 90],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const res = parseGradebookSpreadsheet(
      buf,
      "test.xlsx",
      mockRoster,
      { p1: { ww: "75", pt: "80", ex: "85" } },
      {},
      () => 100,
      "overwrite",
    );

    expect(res.totalRows).toBe(2);
    expect(res.matchedCount).toBe(2);
    // p1 has identical scores, so it should be unchanged
    const juan = res.rows.find((r) => r.student?.id === "p1");
    expect(juan?.status).toBe("unchanged");

    // p2 is new (current is blank)
    const maria = res.rows.find((r) => r.student?.id === "p2");
    expect(maria?.status).toBe("new");
    expect(maria?.selected).toBe(true);
  });

  it("identifies invalid scores (>100 or negative) and unmatched students", () => {
    const csv = `ID,Name,WW,PT,Exam
2024-0001,Juan,105,-5,abc
2024-9999,Unknown Student,90,90,90`;

    const res = parseGradebookSpreadsheet(
      csv,
      "bad.csv",
      mockRoster,
      {},
      {},
      () => 100,
      "overwrite",
    );

    expect(res.totalRows).toBe(2);
    expect(res.unmatchedCount).toBe(1);
    expect(res.invalidCount).toBe(1);

    const juan = res.rows[0];
    expect(juan?.status).toBe("invalid");
    expect(juan?.errors.length).toBeGreaterThan(0);
    expect(juan?.selected).toBe(false);

    const unknown = res.rows[1];
    expect(unknown?.status).toBe("unmatched");
    expect(unknown?.selected).toBe(false);
  });

  it("respects fill_blanks strategy vs overwrite strategy", () => {
    const csv = `ID,WW,PT,Exam
2024-0001,95,95,95`;

    const currentCells = {
      p1: { ww: "80", pt: "", ex: "85" },
    };

    // fill_blanks: only PT should be populated from file
    const resFill = parseGradebookSpreadsheet(
      csv,
      "test.csv",
      mockRoster,
      currentCells,
      {},
      () => 100,
      "fill_blanks",
    );
    const rowFill = resFill.rows[0]!;
    expect(rowFill.targetScores.ww).toBe("80"); // kept existing
    expect(rowFill.targetScores.pt).toBe("95"); // filled blank
    expect(rowFill.targetScores.ex).toBe("85"); // kept existing

    // overwrite: all should be updated to 95
    const resOvr = parseGradebookSpreadsheet(
      csv,
      "test.csv",
      mockRoster,
      currentCells,
      {},
      () => 100,
      "overwrite",
    );
    const rowOvr = resOvr.rows[0]!;
    expect(rowOvr.targetScores.ww).toBe("95");
    expect(rowOvr.targetScores.pt).toBe("95");
    expect(rowOvr.targetScores.ex).toBe("95");
  });
});
