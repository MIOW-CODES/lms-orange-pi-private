import { useId, useRef, useState, useMemo } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  HelpCircle,
  Info,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge, Modal, UserAvatar } from "@/components/ui-elements";
import type { Course, Profile } from "@/lib/lms";
import type { CellState, OverridesState } from "@/components/courses/grade-overrides";
import {
  downloadGradebookTemplate,
  parseGradebookSpreadsheet,
  type GradebookImportResult,
  type GradebookParsedRow,
  type ImportConflictStrategy,
} from "@/lib/gradebook-import";
import { cn } from "@/lib/utils";

interface GradebookImportModalProps {
  open: boolean;
  onClose: () => void;
  course: Course | undefined;
  quarter: number;
  roster: Profile[];
  currentCells: Record<string, CellState>;
  currentOverrides: OverridesState;
  attOf: (studentId: string) => number | null;
  onApply: (
    updatedCells: Record<string, CellState>,
    updatedOverrides: OverridesState,
    appliedCount: number,
    saveImmediately?: boolean,
  ) => void;
}

type TabFilter = "all" | "changes" | "issues";

export function GradebookImportModal({
  open,
  onClose,
  course,
  quarter,
  roster,
  currentCells,
  currentOverrides,
  attOf,
  onApply,
}: GradebookImportModalProps) {
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [strategy, setStrategy] = useState<ImportConflictStrategy>("overwrite");
  const [fileData, setFileData] = useState<{ buffer: ArrayBuffer; name: string } | null>(null);
  const [parsed, setParsed] = useState<GradebookImportResult | null>(null);
  const [tabFilter, setTabFilter] = useState<TabFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setStep("upload");
    setFileData(null);
    setParsed(null);
    setSelectedKeys(new Set());
    setSearch("");
    setTabFilter("all");
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
      const result = parseGradebookSpreadsheet(
        buffer,
        file.name,
        roster,
        currentCells,
        currentOverrides,
        attOf,
        strategy,
      );

      if (result.totalRows === 0) {
        toast.error("No valid data rows found in this file.");
        return;
      }

      setParsed(result);
      // Pre-select all valid rows that have changes or new values
      const initialSelected = new Set(
        result.rows
          .filter((r) => r.student && (r.status === "update" || r.status === "new"))
          .map((r) => r.key),
      );
      setSelectedKeys(initialSelected);
      setStep("review");
      toast.success(
        `Parsed ${result.totalRows} rows (${result.matchedCount} matched in course roster).`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to parse spreadsheet file.");
    }
  };

  const handleStrategyChange = (newStrategy: ImportConflictStrategy) => {
    setStrategy(newStrategy);
    if (fileData) {
      const result = parseGradebookSpreadsheet(
        fileData.buffer,
        fileData.name,
        roster,
        currentCells,
        currentOverrides,
        attOf,
        newStrategy,
      );
      setParsed(result);
      const initialSelected = new Set(
        result.rows
          .filter((r) => r.student && (r.status === "update" || r.status === "new"))
          .map((r) => r.key),
      );
      setSelectedKeys(initialSelected);
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

  const toggleSelectAll = (filteredRows: GradebookParsedRow[]) => {
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

  // Filtered rows in review screen
  const visibleRows = useMemo(() => {
    if (!parsed) return [];
    let list = parsed.rows;
    if (tabFilter === "changes") {
      list = list.filter((r) => r.status === "update" || r.status === "new");
    } else if (tabFilter === "issues") {
      list = list.filter((r) => r.status === "invalid" || r.status === "unmatched");
    }

    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter(
        (r) =>
          (r.student?.full_name ?? r.rawName).toLowerCase().includes(q) ||
          (r.student?.student_id ?? r.rawIdentifier).toLowerCase().includes(q) ||
          (r.student?.section ?? r.rawSection).toLowerCase().includes(q),
      );
    }
    return list;
  }, [parsed, tabFilter, search]);

  const handleConfirmImport = (saveImmediately = false) => {
    if (!parsed) return;
    const selectedRows = parsed.rows.filter((r) => r.student && selectedKeys.has(r.key));
    if (selectedRows.length === 0) {
      toast.error("Please select at least one student row to import.");
      return;
    }

    const nextCells: Record<string, CellState> = { ...currentCells };
    const nextOverrides: OverridesState = { ...currentOverrides };

    selectedRows.forEach((r) => {
      if (!r.student) return;
      const sid = r.student.id;
      nextCells[sid] = {
        ww: r.targetScores.ww,
        pt: r.targetScores.pt,
        ex: r.targetScores.ex,
      };

      if (r.overrideNote) {
        const studentOvr = { ...(nextOverrides[sid] ?? {}) };
        // Flag whichever component was updated
        if (r.parsedWw != null) studentOvr.ww = { note: r.overrideNote };
        if (r.parsedPt != null) studentOvr.pt = { note: r.overrideNote };
        if (r.parsedEx != null) studentOvr.ex = { note: r.overrideNote };
        nextOverrides[sid] = studentOvr;
      }
    });

    onApply(nextCells, nextOverrides, selectedRows.length, saveImmediately);
    handleClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Import Grades (CSV / Excel)" wide>
      {step === "upload" ? (
        <div className="space-y-6 p-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Upload quarterly grades for {course?.code} — {course?.title} (Q{quarter})
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Accepts Excel (.xlsx, .xls) and CSV files. Automatic header & student number
                matching.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => downloadGradebookTemplate(course, quarter, roster, "xlsx")}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                title="Download formatted Excel template pre-filled with course students"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> Excel Template
              </button>
              <button
                type="button"
                onClick={() => downloadGradebookTemplate(course, quarter, roster, "csv")}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                title="Download formatted CSV template pre-filled with course students"
              >
                <Download className="h-3.5 w-3.5 text-sky-600" /> CSV Template
              </button>
            </div>
          </div>

          {/* Strategy Option */}
          <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Import Conflict Strategy
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                  strategy === "overwrite"
                    ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary"
                    : "border-border/60 bg-card hover:bg-muted/40",
                )}
              >
                <input
                  type="radio"
                  name="import-strategy"
                  checked={strategy === "overwrite"}
                  onChange={() => handleStrategyChange("overwrite")}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-semibold">Overwrite existing scores</p>
                  <p className="text-xs text-muted-foreground">
                    Replace existing scores with the values in the spreadsheet.
                  </p>
                </div>
              </label>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                  strategy === "fill_blanks"
                    ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary"
                    : "border-border/60 bg-card hover:bg-muted/40",
                )}
              >
                <input
                  type="radio"
                  name="import-strategy"
                  checked={strategy === "fill_blanks"}
                  onChange={() => handleStrategyChange("fill_blanks")}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-semibold">Fill blank scores only</p>
                  <p className="text-xs text-muted-foreground">
                    Only populate empty grade cells; keep currently encoded grades untouched.
                  </p>
                </div>
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
              <p className="text-base font-bold">Choose a file or drag and drop</p>
              <p className="text-xs text-muted-foreground mt-1">
                Microsoft Excel (.xlsx, .xls), CSV, or TSV spreadsheets
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0 text-primary" />
            <span>
              Expected columns: <strong>Student No</strong>, <strong>Name</strong>,{" "}
              <strong>WW (20%)</strong>, <strong>PT (40%)</strong>, <strong>Exam (30%)</strong>.
              Order doesn't matter.
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
        /* Human in the Loop Review Step */
        <div className="space-y-4 p-1">
          {/* Summary Chips */}
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
              <p className="text-[10px] font-bold uppercase">Updates</p>
              <p className="font-display text-xl font-bold">{parsed?.changedCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-slate-500/20 bg-slate-500/5 p-2.5 text-center text-slate-600 dark:text-slate-300">
              <p className="text-[10px] font-bold uppercase">Unchanged</p>
              <p className="font-display text-xl font-bold">{parsed?.unchangedCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 text-center text-amber-600 dark:text-amber-300">
              <p className="text-[10px] font-bold uppercase">Unmatched</p>
              <p className="font-display text-xl font-bold">{parsed?.unmatchedCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-2.5 text-center text-rose-600 dark:text-rose-300">
              <p className="text-[10px] font-bold uppercase">Errors</p>
              <p className="font-display text-xl font-bold">{parsed?.invalidCount ?? 0}</p>
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
                onClick={() => setTabFilter("changes")}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  tabFilter === "changes"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground",
                )}
              >
                Changes Only ({parsed?.changedCount ?? 0})
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
                Issues ({(parsed?.unmatchedCount ?? 0) + (parsed?.invalidCount ?? 0)})
              </button>
            </div>

            <div className="relative min-w-48 flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search students..."
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

          {/* Interactive Review Table */}
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
                  <th className="px-3 py-2.5 font-bold uppercase tracking-wider text-muted-foreground text-center">
                    WW (20%)
                  </th>
                  <th className="px-3 py-2.5 font-bold uppercase tracking-wider text-muted-foreground text-center">
                    PT (40%)
                  </th>
                  <th className="px-3 py-2.5 font-bold uppercase tracking-wider text-muted-foreground text-center">
                    Exam (30%)
                  </th>
                  <th className="px-3 py-2.5 font-bold uppercase tracking-wider text-muted-foreground text-center">
                    Preview
                  </th>
                  <th className="px-3 py-2.5 font-bold uppercase tracking-wider text-muted-foreground text-right">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      No records match the current filter.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r) => {
                    const isSelected = selectedKeys.has(r.key);
                    const canSelect = r.student != null && r.errors.length === 0;

                    return (
                      <tr
                        key={r.key}
                        className={cn(
                          "transition-colors hover:bg-muted/30",
                          isSelected ? "bg-primary/[0.03]" : "",
                          r.status === "invalid" || r.status === "unmatched"
                            ? "bg-rose-500/[0.04]"
                            : "",
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
                          {r.errors.length > 0 && (
                            <p className="mt-0.5 text-[10px] text-rose-600 font-medium">
                              {r.errors.join("; ")}
                            </p>
                          )}
                          {r.overrideNote && (
                            <p className="mt-0.5 text-[10px] text-indigo-600 dark:text-indigo-400">
                              Note: {r.overrideNote}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono">
                          {r.targetScores.ww !== r.currentScores.ww ? (
                            <span className="flex items-center justify-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                              <span className="line-through text-muted-foreground font-normal text-[10px]">
                                {r.currentScores.ww || "—"}
                              </span>
                              <span>→ {r.targetScores.ww}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {r.targetScores.ww || "—"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono">
                          {r.targetScores.pt !== r.currentScores.pt ? (
                            <span className="flex items-center justify-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                              <span className="line-through text-muted-foreground font-normal text-[10px]">
                                {r.currentScores.pt || "—"}
                              </span>
                              <span>→ {r.targetScores.pt}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {r.targetScores.pt || "—"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono">
                          {r.targetScores.ex !== r.currentScores.ex ? (
                            <span className="flex items-center justify-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                              <span className="line-through text-muted-foreground font-normal text-[10px]">
                                {r.currentScores.ex || "—"}
                              </span>
                              <span>→ {r.targetScores.ex}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {r.targetScores.ex || "—"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {r.preview ? (
                            <div>
                              <span className="font-display font-bold text-foreground">
                                {r.preview.transmuted}
                              </span>
                              <p className="text-[10px] text-muted-foreground">
                                {r.preview.remarks}
                              </p>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {r.status === "update" ? (
                            <Badge tone="green">Will Update</Badge>
                          ) : r.status === "new" ? (
                            <Badge tone="sky">New Scores</Badge>
                          ) : r.status === "unchanged" ? (
                            <Badge tone="slate">No Change</Badge>
                          ) : r.status === "unmatched" ? (
                            <Badge tone="amber">Unmatched</Badge>
                          ) : (
                            <Badge tone="red">Error</Badge>
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
              className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Upload
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="h-10 rounded-xl border border-border bg-card px-4 text-xs font-semibold hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedKeys.size === 0}
                onClick={() => handleConfirmImport(false)}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
                title="Loads imported grades onto the gradebook screen for your inspection before publishing"
              >
                <CheckCircle2 className="h-4 w-4" /> Apply to Gradebook ({selectedKeys.size})
              </button>
              <button
                type="button"
                disabled={selectedKeys.size === 0}
                onClick={() => handleConfirmImport(true)}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                title="Immediately saves and publishes imported grades to the database"
              >
                Save & Publish ({selectedKeys.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
