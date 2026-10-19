import * as XLSX from "xlsx";
import type { AttendanceLog, AttendanceStatus, Profile } from "@/lib/lms";
import { buildXlsx, downloadBlob, downloadCsv, type XlsxCell } from "@/lib/xlsx";

export interface AttendanceParsedRow {
  key: string;
  line: number;
  selected: boolean;
  student: Profile | null;
  rawIdentifier: string;
  rawName: string;
  rawDate: string;
  rawTime: string;
  rawScanType: string;
  rawStatus: string;
  parsedDate: string; // YYYY-MM-DD
  parsedTime: string; // HH:mm:ss
  timestamp: string; // ISO 8601
  scanType: "in" | "out";
  status: AttendanceStatus;
  isDuplicate: boolean;
  errors: string[];
  warnings: string[];
}

export interface AttendanceImportResult {
  fileName: string;
  sheetName: string;
  totalRows: number;
  matchedCount: number;
  unmatchedCount: number;
  inCount: number;
  outCount: number;
  onTimeCount: number;
  lateCount: number;
  excusedCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: AttendanceParsedRow[];
}

function normalizeHeader(h: unknown): string {
  if (h == null) return "";
  return String(h)
    .toLowerCase()
    .trim()
    .replace(/[\s_\-–—()%/.]+/g, "");
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.'"-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses Excel serial date number to Date.
 */
function excelSerialToDate(serial: number): Date {
  // Excel epoch: Dec 30, 1899 (due to Lotus 1-2-3 1900 leap year bug)
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms);
}

/**
 * Normalizes date and time inputs into YYYY-MM-DD, HH:mm:ss and ISO string.
 */
function parseDateTime(
  dateVal: unknown,
  timeVal: unknown,
  fallbackDate: string, // YYYY-MM-DD
): { date: string; time: string; iso: string; error?: string } {
  const dStr = dateVal != null ? String(dateVal).trim() : "";
  const tStr = timeVal != null ? String(timeVal).trim() : "";

  // 1. Check if dateVal is an Excel serial number
  if (typeof dateVal === "number" && dateVal > 20000 && dateVal < 80000) {
    const d = excelSerialToDate(dateVal);
    if (!Number.isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      const seconds = String(d.getSeconds()).padStart(2, "0");
      return {
        date: `${year}-${month}-${day}`,
        time: `${hours}:${minutes}:${seconds}`,
        iso: d.toISOString(),
      };
    }
  }

  // 2. Check if dateVal is already a full ISO / DateTime string
  if (dStr && (dStr.includes("T") || dStr.includes(" ") || dStr.includes("/"))) {
    const d = new Date(dStr);
    if (!Number.isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      const seconds = String(d.getSeconds()).padStart(2, "0");
      return {
        date: `${year}-${month}-${day}`,
        time: `${hours}:${minutes}:${seconds}`,
        iso: d.toISOString(),
      };
    }
  }

  // 3. Date is standard YYYY-MM-DD or MM/DD/YYYY
  let targetDate = fallbackDate;
  if (dStr) {
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dStr)) {
      const [y, m, d] = dStr.split("-");
      targetDate = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dStr)) {
      const [m, d, y] = dStr.split("/");
      targetDate = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    }
  }

  // 4. Parse time (e.g. "07:30 AM", "14:15", "07:30:00")
  let targetTime = "07:30:00";
  if (tStr) {
    // 12-hour AM/PM
    const ampmMatch = tStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (ampmMatch) {
      let h = Number(ampmMatch[1]);
      const m = Number(ampmMatch[2]);
      const s = Number(ampmMatch[3] ?? 0);
      const meridiem = ampmMatch[4]?.toLowerCase();
      if (meridiem === "pm" && h < 12) h += 12;
      if (meridiem === "am" && h === 12) h = 0;
      targetTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    } else if (typeof timeVal === "number" && timeVal >= 0 && timeVal < 1) {
      // Excel fraction of day: 0.3125 * 24 = 7.5 = 07:30
      const totalSec = Math.round(timeVal * 86400);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      targetTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
  }

  const combined = new Date(`${targetDate}T${targetTime}`);
  if (Number.isNaN(combined.getTime())) {
    return {
      date: targetDate,
      time: targetTime,
      iso: new Date().toISOString(),
      error: `Could not parse date "${dStr}" or time "${tStr}"`,
    };
  }

  return {
    date: targetDate,
    time: targetTime,
    iso: combined.toISOString(),
  };
}

function parseScanType(val: unknown): "in" | "out" {
  if (val == null) return "in";
  const s = String(val).toLowerCase().trim();
  if (s === "out" || s === "tap out" || s === "tapout" || s === "exit" || s === "logout") {
    return "out";
  }
  return "in";
}

function parseStatus(statusVal: unknown, timeStr: string): AttendanceStatus {
  if (statusVal != null && String(statusVal).trim()) {
    const s = String(statusVal).toLowerCase().trim();
    if (s === "late" || s === "tardy") return "late";
    if (s === "excused") return "excused";
    if (s === "on-time" || s === "ontime" || s === "on time" || s === "present") return "on-time";
  }
  // If status is unspecified, evaluate against 7:40 AM threshold
  const [h, m] = timeStr.split(":").map(Number);
  const minutes = (h ?? 0) * 60 + (m ?? 0);
  return minutes <= 7 * 60 + 40 ? "on-time" : "late";
}

export function parseAttendanceSpreadsheet(
  buffer: ArrayBuffer | Uint8Array | string,
  fileName: string,
  students: Profile[],
  existingLogs: AttendanceLog[] = [],
  fallbackDate = new Date().toISOString().slice(0, 10),
): AttendanceImportResult {
  const wb =
    typeof buffer === "string"
      ? XLSX.read(buffer, { type: "string", raw: true })
      : XLSX.read(buffer, { type: "array", raw: true });

  const sheetName = wb.SheetNames[0] ?? "Sheet1";
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return {
      fileName,
      sheetName,
      totalRows: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      inCount: 0,
      outCount: 0,
      onTimeCount: 0,
      lateCount: 0,
      excusedCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      rows: [],
    };
  }

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  if (rawRows.length === 0) {
    return {
      fileName,
      sheetName,
      totalRows: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      inCount: 0,
      outCount: 0,
      onTimeCount: 0,
      lateCount: 0,
      excusedCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      rows: [],
    };
  }

  // Detect header row
  let headerIndex = -1;
  let idCol = -1;
  let nameCol = -1;
  let dateCol = -1;
  let timeCol = -1;
  let typeCol = -1;
  let statusCol = -1;

  for (let r = 0; r < Math.min(10, rawRows.length); r++) {
    const row = rawRows[r] as unknown[];
    if (!Array.isArray(row)) continue;

    let hasId = false;
    let hasName = false;
    let hasDate = false;
    let hasTime = false;
    let hasType = false;
    let hasStatus = false;

    row.forEach((cell, idx) => {
      const norm = normalizeHeader(cell);
      if (!norm) return;

      if (
        norm === "studentno" ||
        norm === "studentid" ||
        norm === "idnumber" ||
        norm === "lrn" ||
        norm === "id" ||
        norm === "rfid" ||
        norm === "rfiduid"
      ) {
        hasId = true;
      } else if (
        norm === "name" ||
        norm === "studentname" ||
        norm === "fullname" ||
        norm === "student"
      ) {
        hasName = true;
      } else if (
        norm === "date" ||
        norm === "scandate" ||
        norm === "attendancedate" ||
        norm === "timestamp" ||
        norm === "datetime"
      ) {
        hasDate = true;
      } else if (
        norm === "time" ||
        norm === "scantime" ||
        norm === "intime" ||
        norm === "taptime"
      ) {
        hasTime = true;
      } else if (
        norm === "scantype" ||
        norm === "type" ||
        norm === "direction" ||
        norm === "inout" ||
        norm === "scan"
      ) {
        hasType = true;
      } else if (
        norm === "status" ||
        norm === "mark" ||
        norm === "remarks" ||
        norm === "attendance" ||
        norm === "state"
      ) {
        hasStatus = true;
      }
    });

    if ((hasId || hasName) && (hasDate || hasTime || hasType || hasStatus)) {
      headerIndex = r;
      row.forEach((cell, idx) => {
        const norm = normalizeHeader(cell);
        if (!norm) return;

        if (
          idCol === -1 &&
          (norm === "studentno" ||
            norm === "studentid" ||
            norm === "idnumber" ||
            norm === "lrn" ||
            norm === "id" ||
            norm === "rfid" ||
            norm === "rfiduid")
        ) {
          idCol = idx;
        } else if (
          nameCol === -1 &&
          (norm === "name" || norm === "studentname" || norm === "fullname" || norm === "student")
        ) {
          nameCol = idx;
        } else if (
          dateCol === -1 &&
          (norm === "date" ||
            norm === "scandate" ||
            norm === "attendancedate" ||
            norm === "timestamp" ||
            norm === "datetime")
        ) {
          dateCol = idx;
        } else if (
          timeCol === -1 &&
          (norm === "time" || norm === "scantime" || norm === "intime" || norm === "taptime")
        ) {
          timeCol = idx;
        } else if (
          typeCol === -1 &&
          (norm === "scantype" ||
            norm === "type" ||
            norm === "direction" ||
            norm === "inout" ||
            norm === "scan")
        ) {
          typeCol = idx;
        } else if (
          statusCol === -1 &&
          (norm === "status" ||
            norm === "mark" ||
            norm === "remarks" ||
            norm === "attendance" ||
            norm === "state")
        ) {
          statusCol = idx;
        }
      });
      break;
    }
  }

  // Fallback defaults if header was not detected
  if (headerIndex === -1) {
    headerIndex = 0;
    idCol = 0;
    nameCol = 1;
    dateCol = 2;
    timeCol = 3;
    typeCol = 4;
    statusCol = 5;
  }

  // Fast lookup maps for students
  const byId = new Map<string, Profile>();
  const byRfid = new Map<string, Profile>();
  const byEmail = new Map<string, Profile>();
  const byName = new Map<string, Profile>();

  students.forEach((s) => {
    if (s.student_id) byId.set(s.student_id.toLowerCase().trim(), s);
    if (s.rfid_uid) byRfid.set(s.rfid_uid.toLowerCase().trim(), s);
    if (s.email) byEmail.set(s.email.toLowerCase().trim(), s);
    if (s.full_name) {
      byName.set(normalizeName(s.full_name), s);
      const parts = s.full_name.split(/\s+/);
      if (parts.length >= 2) {
        const lastFirst = `${parts[parts.length - 1]} ${parts.slice(0, parts.length - 1).join(" ")}`;
        byName.set(normalizeName(lastFirst), s);
      }
    }
  });

  // Fast lookup set for existing logs: "studentId:YYYY-MM-DD:scan_type"
  const existingSet = new Set<string>();
  existingLogs.forEach((l) => {
    const d = new Date(l.timestamp);
    if (!Number.isNaN(d.getTime())) {
      const dayStr = d.toISOString().slice(0, 10);
      existingSet.add(`${l.student_id}:${dayStr}:${l.scan_type}`);
    }
  });

  const parsedRows: AttendanceParsedRow[] = [];
  const seenInFile = new Set<string>();
  const startRow = headerIndex + 1;

  for (let r = startRow; r < rawRows.length; r++) {
    const row = rawRows[r] as unknown[];
    if (!Array.isArray(row)) continue;

    const rawId = idCol >= 0 ? String(row[idCol] ?? "").trim() : "";
    const rawName = nameCol >= 0 ? String(row[nameCol] ?? "").trim() : "";
    const rawDate = dateCol >= 0 ? String(row[dateCol] ?? "").trim() : "";
    const rawTime = timeCol >= 0 ? String(row[timeCol] ?? "").trim() : "";
    const rawType = typeCol >= 0 ? String(row[typeCol] ?? "").trim() : "";
    const rawStatus = statusCol >= 0 ? String(row[statusCol] ?? "").trim() : "";

    // Skip empty row
    if (!rawId && !rawName && !rawDate && !rawTime) continue;

    let student: Profile | null = null;
    if (rawId) {
      student = byId.get(rawId.toLowerCase()) ?? byRfid.get(rawId.toLowerCase()) ?? null;
      if (!student && rawId.includes("@")) {
        student = byEmail.get(rawId.toLowerCase()) ?? null;
      }
    }
    if (!student && rawName) {
      student = byName.get(normalizeName(rawName)) ?? null;
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!student) {
      errors.push(`Student not recognized: "${rawId || rawName}"`);
    }

    const { date, time, iso, error: dtError } = parseDateTime(rawDate, rawTime, fallbackDate);
    if (dtError) errors.push(dtError);

    const scanType = parseScanType(rawType);
    const status = parseStatus(rawStatus, time);

    let isDuplicate = false;
    if (student) {
      const fileKey = `${student.id}:${date}:${scanType}`;
      if (seenInFile.has(fileKey)) {
        isDuplicate = true;
        warnings.push(`Duplicate entry in file for this student on ${date} (${scanType})`);
      } else {
        seenInFile.add(fileKey);
      }

      if (existingSet.has(fileKey)) {
        isDuplicate = true;
        warnings.push(`Record already exists in system for ${date} (${scanType})`);
      }
    }

    parsedRows.push({
      key: `row-${r}-${student?.id ?? rawId}`,
      line: r + 1,
      selected: errors.length === 0 && student != null,
      student,
      rawIdentifier: rawId,
      rawName,
      rawDate,
      rawTime,
      rawScanType: rawType,
      rawStatus,
      parsedDate: date,
      parsedTime: time,
      timestamp: iso,
      scanType,
      status,
      isDuplicate,
      errors,
      warnings,
    });
  }

  const matchedCount = parsedRows.filter((r) => r.student != null).length;
  const unmatchedCount = parsedRows.filter((r) => r.student == null).length;
  const inCount = parsedRows.filter((r) => r.scanType === "in").length;
  const outCount = parsedRows.filter((r) => r.scanType === "out").length;
  const onTimeCount = parsedRows.filter((r) => r.status === "on-time").length;
  const lateCount = parsedRows.filter((r) => r.status === "late").length;
  const excusedCount = parsedRows.filter((r) => r.status === "excused").length;
  const duplicateCount = parsedRows.filter((r) => r.isDuplicate).length;
  const errorCount = parsedRows.filter((r) => r.errors.length > 0).length;

  return {
    fileName,
    sheetName,
    totalRows: parsedRows.length,
    matchedCount,
    unmatchedCount,
    inCount,
    outCount,
    onTimeCount,
    lateCount,
    excusedCount,
    duplicateCount,
    errorCount,
    rows: parsedRows,
  };
}

/**
 * Downloads a sample attendance template pre-filled with active students.
 */
export function downloadAttendanceTemplate(
  students: Profile[],
  format: "csv" | "xlsx" = "xlsx",
): void {
  const header: XlsxCell[] = [
    "Student No",
    "Full Name",
    "Section",
    "Date",
    "Time",
    "Scan Type",
    "Status",
  ];

  const today = new Date().toISOString().slice(0, 10);
  const sortedStudents = [...students].sort((a, b) => a.full_name.localeCompare(b.full_name));

  const rows: XlsxCell[][] = sortedStudents
    .slice(0, 50)
    .map((s, i) => [
      s.student_id ?? "",
      s.full_name,
      s.section ?? "",
      today,
      i % 5 === 0 ? "07:45 AM" : "07:25 AM",
      "in",
      i % 5 === 0 ? "late" : "on-time",
    ]);

  const baseName = `attendance-template-${today}`;

  if (format === "csv") {
    downloadCsv([header, ...rows], `${baseName}.csv`);
  } else {
    const blob = buildXlsx([{ name: "Attendance", rows: [header, ...rows] }]);
    downloadBlob(blob, `${baseName}.xlsx`);
  }
}

/**
 * Exports existing attendance logs to CSV.
 */
export function exportAttendanceCsv(
  logs: AttendanceLog[],
  students: Profile[],
  fileName = `miow-attendance-${new Date().toISOString().slice(0, 10)}.csv`,
): void {
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const header = ["Student No", "Name", "Section", "Date", "Time", "Scan Type", "Status"];

  const rows = logs.map((l) => {
    const s = studentMap.get(l.student_id);
    const d = new Date(l.timestamp);
    const dateStr = !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : "";
    const timeStr = !Number.isNaN(d.getTime())
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "";
    return [
      s?.student_id ?? "",
      s?.full_name ?? "Unknown",
      s?.section ?? "",
      dateStr,
      timeStr,
      l.scan_type,
      l.status,
    ];
  });

  const csv = [header, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), fileName);
}

/**
 * Exports existing attendance logs to Excel (.xlsx).
 */
export function exportAttendanceXlsx(
  logs: AttendanceLog[],
  students: Profile[],
  fileName = `miow-attendance-${new Date().toISOString().slice(0, 10)}.xlsx`,
): void {
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const header: XlsxCell[] = [
    "Student No",
    "Name",
    "Section",
    "Date",
    "Time",
    "Scan Type",
    "Status",
  ];

  const body: XlsxCell[][] = logs.map((l) => {
    const s = studentMap.get(l.student_id);
    const d = new Date(l.timestamp);
    const dateStr = !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : "";
    const timeStr = !Number.isNaN(d.getTime())
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "";
    return [
      s?.student_id ?? "",
      s?.full_name ?? "Unknown",
      s?.section ?? "",
      dateStr,
      timeStr,
      l.scan_type,
      l.status,
    ];
  });

  const blob = buildXlsx([{ name: "Attendance Logs", rows: [header, ...body] }]);
  downloadBlob(blob, fileName);
}
