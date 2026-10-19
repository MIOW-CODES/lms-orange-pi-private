import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  Info,
  Loader2,
  LogIn,
  LogOut,
  Search,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge, Modal, UserAvatar } from "@/components/ui-elements";
import {
  bulkLogAttendance,
  type AttendanceLog,
  type AttendanceStatus,
  type Profile,
} from "@/lib/lms";
import {
  downloadAttendanceTemplate,
  parseAttendanceSpreadsheet,
  type AttendanceImportResult,
  type AttendanceParsedRow,
} from "@/lib/attendance-import";
import { cn } from "@/lib/utils";

interface AttendanceImportModalProps {
  open: boolean;
  onClose: () => void;
  students: Profile[];
  existingLogs: AttendanceLog[];
  onImportComplete: () => void;
}

type TabFilter = "all" | "valid" | "dupes" | "issues";

export function AttendanceImportModal({
  open,
  onClose,
  students,
  existingLogs,
  onImportComplete,
}: AttendanceImportModalProps) {
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [fallbackDate, setFallbackDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [fileData, setFileData] = useState<{ buffer: ArrayBuffer; name: string } | null>(null);
  const [parsed, setParsed] = useState<AttendanceImportResult | null>(null);
  const [tabFilter, setTabFilter] = useState<TabFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [editingStatuses, setEditingStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [dragActive, setDragActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setStep("upload");
    setFileData(null);
    setParsed(null);
    setSelectedKeys(new Set());
    setEditingStatuses({});
    setSearch("");
    setTabFilter("all");
    setSaving(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const processFile = async (file: File) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      setFileData({ buffer, name: file.name });
      const result = parseAttendanceSpreadsheet(
        buffer,
        file.name,
        students,
        existingLogs,
        fallbackDate,
      );

      if (result.totalRows === 0) {
        toast.error("No valid attendance rows found in this file.");
        return;
      }

      setParsed(result);

      // Pre-select non-error and non-duplicate rows (if skipDuplicates enabled)
      const initialSelected = new Set(
        result.rows
          .filter((r) => r.student && r.errors.length === 0 && (!skipDuplicates || !r.isDuplicate))
          .map((r) => r.key),
      );
      setSelectedKeys(initialSelected);
      setStep("review");
      toast.success(
        `Parsed ${result.totalRows} records (${result.matchedCount} matched students).`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to parse attendance file.");
    }
  };

  const reparseWithNewDate = (newDate: string) => {
    setFallbackDate(newDate);
    if (fileData) {
      const result = parseAttendanceSpreadsheet(
        fileData.buffer,
        fileData.name,
        students,
        existingLogs,
        newDate,
      );
      setParsed(result);
      const initialSelected = new Set(
        result.rows
          .filter((r) => r.student && r.errors.length === 0 && (!skipDuplicates || !r.isDuplicate))
          .map((r) => r.key),
      );
      setSelectedKeys(initialSelected);
    }
  };

  const handleSkipDuplicatesChange = (shouldSkip: boolean) => {
    setSkipDuplicates(shouldSkip);
    if (parsed) {
      const nextSelected = new Set(
        parsed.rows
          .filter((r) => r.student && r.errors.length === 0 && (!shouldSkip || !r.isDuplicate))
          .map((r) => r.key),
      );
      setSelectedKeys(nextSelected);
    }
  };

  const toggleSelectRow = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = (filteredRows: AttendanceParsedRow[]) => {
    const selectable = filteredRows.filter((r) => r.student && r.errors.length === 0);
    const allSelected = selectable.every((r) => selectedKeys.has(r.key));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        selectable.forEach((r) => next.delete(r.key));
      } else {
        selectable.forEach((r) => next.add(r.key));
      }
      return next;
    });
  };

  const handleStatusOverride = (key: string, status: AttendanceStatus) => {
    setEditingStatuses((prev) => ({ ...prev, [key]: status }));
  };

  // Filtered rows for review table
  const visibleRows = useMemo(() => {
    if (!parsed) return [];
    let list = parsed.rows;
    if (tabFilter === "valid") {
      list = list.filter((r) => r.student && r.errors.length === 0 && !r.isDuplicate);
    } else if (tabFilter === "dupes") {
      list = list.filter((r) => r.isDuplicate);
    } else if (tabFilter === "issues") {
      list = list.filter((r) => r.errors.length > 0 || !r.student);
    }

    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter(
        (r) =>
          (r.student?.full_name ?? r.rawName).toLowerCase().includes(q) ||
          (r.student?.student_id ?? r.rawIdentifier).toLowerCase().includes(q) ||
          (r.student?.section ?? "").toLowerCase().includes(q) ||
          r.parsedDate.includes(q),
      );
    }
    return list;
  }, [parsed, tabFilter, search]);

  const handleConfirmImport = async () => {
    if (!parsed) return;
    const selectedRows = parsed.rows.filter((r) => r.student && selectedKeys.has(r.key));
    if (selectedRows.length === 0) {
      toast.error("Please select at least one attendance record to import.");
      return;
    }

    setSaving(true);
    try {
      const items = selectedRows.map((r) => ({
        student_id: r.student!.id,
        scan_type: r.scanType,
        status: editingStatuses[r.key] ?? r.status,
        timestamp: r.timestamp,
      }));

      const res = await bulkLogAttendance(items);
      toast.success(
        `Successfully imported ${res.count} attendance record${res.count === 1 ? "" : "s"}.`,
      );
      onImportComplete();
      handleClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to import attendance records.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Import Attendance (CSV / Excel)" wide>
      {step === "upload" ? (
        <div className="space-y-6 p-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Import Gate / Classroom Attendance Records
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upload scans from Excel (.xlsx, .xls) or CSV files. Automatically matches student
                records.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => downloadAttendanceTemplate(students, "xlsx")}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                title="Download formatted Excel attendance template"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> Excel Template
              </button>
              <button
                type="button"
                onClick={() => downloadAttendanceTemplate(students, "csv")}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                title="Download formatted CSV attendance template"
              >
                <Download className="h-3.5 w-3.5 text-sky-600" /> CSV Template
              </button>
            </div>
          </div>

          {/* Config: Target Date & Duplicate Settings */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
              <label
                htmlFor="fallback-date"
                className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1 block"
              >
                Target / Default Date
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Applied when rows only specify times or omit dates.
              </p>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="fallback-date"
                  type="date"
                  value={fallbackDate}
                  onChange={(e) => reparseWithNewDate(e.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 flex flex-col justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">
                  Duplicate Records
                </p>
                <p className="text-xs text-muted-foreground">
                  Prevent duplicate tap entries for the same student on the same day and scan type.
                </p>
              </div>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => handleSkipDuplicatesChange(e.target.checked)}
                  className="rounded border-input"
                />
                <span>Automatically deselect duplicate scans</span>
              </label>
            </div>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void processFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition cursor-pointer",
              dragActive
                ? "border-primary bg-primary/10"
                : "border-border/80 bg-card/60 hover:border-primary/60 hover:bg-muted/40",
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void processFile(file);
                e.target.value = "";
              }}
            />
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Upload className="h-6 w-6" />
            </div>
            <div>
              <p className="text-base font-bold">Choose an attendance spreadsheet or drag & drop</p>
              <p className="text-xs text-muted-foreground mt-1">
                Supports Excel (.xlsx, .xls) and CSV. Columns: Student No, Date, Time, Scan Type,
                Status.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0 text-primary" />
            <span>
              If Status is blank, arrivals before 7:40 AM are automatically marked{" "}
              <strong>On Time</strong>, and after 7:40 AM are marked <strong>Late</strong>.
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Human in the loop Review Screen */
        <div className="space-y-4 p-1">
          {/* Summary metrics */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <div className="rounded-xl border border-border/60 bg-card p-2.5 text-center">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Total Rows</p>
              <p className="font-display text-xl font-bold">{parsed?.totalRows ?? 0}</p>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-center text-emerald-600 dark:text-emerald-300">
              <p className="text-[10px] font-bold uppercase">Matched</p>
              <p className="font-display text-xl font-bold">{parsed?.matchedCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-2.5 text-center text-sky-600 dark:text-sky-300">
              <p className="text-[10px] font-bold uppercase">In / Out</p>
              <p className="font-display text-xl font-bold">
                {parsed?.inCount ?? 0} / {parsed?.outCount ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 text-center text-amber-600 dark:text-amber-300">
              <p className="text-[10px] font-bold uppercase">Late Scans</p>
              <p className="font-display text-xl font-bold">{parsed?.lateCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-slate-500/20 bg-slate-500/5 p-2.5 text-center text-slate-600 dark:text-slate-300">
              <p className="text-[10px] font-bold uppercase">Duplicates</p>
              <p className="font-display text-xl font-bold">{parsed?.duplicateCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-2.5 text-center text-rose-600 dark:text-rose-300">
              <p className="text-[10px] font-bold uppercase">Errors / Unmatched</p>
              <p className="font-display text-xl font-bold">
                {(parsed?.unmatchedCount ?? 0) + (parsed?.errorCount ?? 0)}
              </p>
            </div>
          </div>

          {/* Controls toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
              <button
                type="button"
                onClick={() => setTabFilter("all")}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  tabFilter === "all"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground",
                )}
              >
                All ({parsed?.totalRows ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setTabFilter("valid")}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  tabFilter === "valid"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground",
                )}
              >
                Valid
              </button>
              <button
                type="button"
                onClick={() => setTabFilter("dupes")}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  tabFilter === "dupes"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground",
                )}
              >
                Duplicates ({parsed?.duplicateCount ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setTabFilter("issues")}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  tabFilter === "issues"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground",
                )}
              >
                Issues ({(parsed?.unmatchedCount ?? 0) + (parsed?.errorCount ?? 0)})
              </button>
            </div>

            <div className="relative min-w-48 flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search students, dates..."
                className="h-9 w-full rounded-xl border border-input bg-background pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">
                {selectedKeys.size} selected for import
              </span>
              <button
                type="button"
                onClick={() => toggleSelectAll(visibleRows)}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Toggle Visible
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="custom-scrollbar max-h-[420px] overflow-x-auto overflow-y-auto rounded-2xl border border-border bg-card">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/90 backdrop-blur-sm">
                <tr>
                  <th className="w-10 px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={
                        visibleRows.length > 0 &&
                        visibleRows.filter((r) => r.student && r.errors.length === 0).length > 0 &&
                        visibleRows
                          .filter((r) => r.student && r.errors.length === 0)
                          .every((r) => selectedKeys.has(r.key))
                      }
                      onChange={() => toggleSelectAll(visibleRows)}
                    />
                  </th>
                  <th className="px-3 py-2.5 font-bold uppercase tracking-wider text-muted-foreground">
                    Student
                  </th>
                  <th className="px-3 py-2.5 font-bold uppercase tracking-wider text-muted-foreground">
                    Date & Time
                  </th>
                  <th className="px-3 py-2.5 font-bold uppercase tracking-wider text-muted-foreground text-center">
                    Type
                  </th>
                  <th className="px-3 py-2.5 font-bold uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                  <th className="px-3 py-2.5 font-bold uppercase tracking-wider text-muted-foreground text-right">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      No records match the current filter.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r) => {
                    const isSelected = selectedKeys.has(r.key);
                    const canSelect = r.student != null && r.errors.length === 0;
                    const effectiveStatus = editingStatuses[r.key] ?? r.status;

                    return (
                      <tr
                        key={r.key}
                        className={cn(
                          "transition-colors hover:bg-muted/30",
                          isSelected ? "bg-primary/[0.03]" : "",
                          r.errors.length > 0 || !r.student ? "bg-rose-500/[0.04]" : "",
                        )}
                      >
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!canSelect}
                            onChange={() => toggleSelectRow(r.key)}
                            aria-label={`Select ${r.student?.full_name ?? r.rawName}`}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          {r.student ? (
                            <div className="flex items-center gap-2">
                              <UserAvatar
                                name={r.student.full_name}
                                src={r.student.avatar_url}
                                className="h-7 w-7 text-xs"
                              />
                              <div>
                                <p className="font-semibold text-foreground">
                                  {r.student.full_name}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {r.student.student_id} · {r.student.section ?? "No section"}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p className="font-semibold text-rose-600 dark:text-rose-400">
                                {r.rawName || "Unknown Student"}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                ID: {r.rawIdentifier || "None"}
                              </p>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono">
                          <p className="font-medium text-foreground">{r.parsedDate}</p>
                          <p className="text-[11px] text-muted-foreground">{r.parsedTime}</p>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              r.scanType === "in"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
                            )}
                          >
                            {r.scanType === "in" ? (
                              <LogIn className="h-3 w-3" />
                            ) : (
                              <LogOut className="h-3 w-3" />
                            )}
                            {r.scanType === "in" ? "IN" : "OUT"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <select
                            value={effectiveStatus}
                            onChange={(e) =>
                              handleStatusOverride(r.key, e.target.value as AttendanceStatus)
                            }
                            aria-label="Status override"
                            className={cn(
                              "h-7 rounded-lg border px-2 text-xs font-semibold outline-none focus:ring-1 focus:ring-ring",
                              effectiveStatus === "on-time"
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : effectiveStatus === "late"
                                  ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300"
                                  : "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-950/40 dark:text-violet-300",
                            )}
                          >
                            <option value="on-time">On time</option>
                            <option value="late">Late</option>
                            <option value="excused">Excused</option>
                          </select>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {r.errors.length > 0 ? (
                            <span className="text-[11px] font-medium text-rose-600">
                              {r.errors.join("; ")}
                            </span>
                          ) : r.isDuplicate ? (
                            <Badge tone="amber">Duplicate</Badge>
                          ) : (
                            <Badge tone="green">Ready</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStep("upload")}
              disabled={saving}
              className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Upload
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={saving}
                className="h-10 rounded-xl border border-border bg-card px-4 text-xs font-semibold hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedKeys.size === 0 || saving}
                onClick={handleConfirmImport}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Importing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Import {selectedKeys.size} Attendance
                    Records
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
