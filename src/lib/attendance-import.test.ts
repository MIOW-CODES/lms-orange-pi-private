import { describe, expect, it } from "bun:test";
import { parseAttendanceSpreadsheet } from "./attendance-import";
import type { AttendanceLog, Profile } from "./lms";
import * as XLSX from "xlsx";

const mockStudents: Profile[] = [
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

const mockExistingLogs: AttendanceLog[] = [
  {
    id: "log1",
    student_id: "p1",
    timestamp: "2026-10-15T07:20:00.000Z",
    scan_type: "in",
    status: "on-time",
  },
];

describe("parseAttendanceSpreadsheet", () => {
  it("parses CSV with standard attendance columns", () => {
    const csv = `Student No,Name,Date,Time,Scan Type,Status
2024-0001,Juan Dela Cruz,2026-10-16,07:25 AM,in,on-time
2024-0002,Maria Santos,2026-10-16,07:55 AM,in,late
2024-0001,Juan Dela Cruz,2026-10-16,04:30 PM,out,on-time`;

    const res = parseAttendanceSpreadsheet(
      csv,
      "attendance.csv",
      mockStudents,
      mockExistingLogs,
      "2026-10-16",
    );

    expect(res.totalRows).toBe(3);
    expect(res.matchedCount).toBe(3);
    expect(res.unmatchedCount).toBe(0);
    expect(res.inCount).toBe(2);
    expect(res.outCount).toBe(1);
    expect(res.onTimeCount).toBe(2);
    expect(res.lateCount).toBe(1);
    expect(res.duplicateCount).toBe(0);

    const juanIn = res.rows[0]!;
    expect(juanIn.student?.id).toBe("p1");
    expect(juanIn.parsedDate).toBe("2026-10-16");
    expect(juanIn.parsedTime).toBe("07:25:00");
    expect(juanIn.scanType).toBe("in");
    expect(juanIn.status).toBe("on-time");

    const mariaIn = res.rows[1]!;
    expect(mariaIn.status).toBe("late");

    const juanOut = res.rows[2]!;
    expect(juanOut.scanType).toBe("out");
    expect(juanOut.parsedTime).toBe("16:30:00");
  });

  it("handles XLSX binary format cleanly", () => {
    const data = [
      ["Student ID", "Full Name", "Date", "Time", "Type", "Status"],
      ["2024-0001", "Juan Dela Cruz", "2026-10-16", "07:30", "in", "on-time"],
      ["2024-0002", "Maria Santos", "2026-10-16", "07:45", "in", "late"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const res = parseAttendanceSpreadsheet(
      buf,
      "test.xlsx",
      mockStudents,
      mockExistingLogs,
      "2026-10-16",
    );

    expect(res.totalRows).toBe(2);
    expect(res.matchedCount).toBe(2);
    expect(res.inCount).toBe(2);
  });

  it("flags duplicates against existing logs and intra-file duplicates", () => {
    // 2026-10-15 IN already exists in mockExistingLogs for p1
    const csv = `ID,Name,Date,Time,Type
2024-0001,Juan,2026-10-15,07:20,in
2024-0001,Juan,2026-10-15,07:25,in`;

    const res = parseAttendanceSpreadsheet(
      csv,
      "dupes.csv",
      mockStudents,
      mockExistingLogs,
      "2026-10-15",
    );

    expect(res.totalRows).toBe(2);
    expect(res.duplicateCount).toBe(2); // both are marked as duplicates (one against DB, one in-file)
    expect(res.rows[0]?.isDuplicate).toBe(true);
    expect(res.rows[1]?.isDuplicate).toBe(true);
  });

  it("flags unknown students cleanly", () => {
    const csv = `ID,Name,Date,Time
2024-9999,Unknown Student,2026-10-16,07:30`;

    const res = parseAttendanceSpreadsheet(csv, "unknown.csv", mockStudents, []);

    expect(res.totalRows).toBe(1);
    expect(res.matchedCount).toBe(0);
    expect(res.unmatchedCount).toBe(1);
    expect(res.rows[0]?.errors.length).toBeGreaterThan(0);
    expect(res.rows[0]?.selected).toBe(false);
  });

  it("evaluates on-time vs late automatically when status column is omitted", () => {
    const csv = `Student No,Date,Time,Type
2024-0001,2026-10-16,07:20 AM,in
2024-0002,2026-10-16,07:50 AM,in`;

    const res = parseAttendanceSpreadsheet(csv, "auto-status.csv", mockStudents, [], "2026-10-16");

    expect(res.rows[0]?.status).toBe("on-time"); // 07:20 is <= 07:40
    expect(res.rows[1]?.status).toBe("late"); // 07:50 is > 07:40
  });
});
