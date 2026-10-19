import { useBlocker } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, FileUp, Plus, Printer, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getClassRecord, saveClassRecord, termLabel, type Profile } from "@/lib/lms";
import {
  calculateRecord,
  recordCell,
  type RecordCategory,
  type RecordDraft,
  type RecordSource,
  type RecordScale,
  type SessionStatus,
} from "@/lib/class-record";
import {
  previewRecordImport,
  recordSheetRows,
  type RecordImportPreview,
} from "@/lib/class-record-spreadsheet";
import { downloadBlob, downloadCsv } from "@/lib/xlsx";
import { Card, EmptyState } from "@/components/lms";
import { cn } from "@/lib/utils";
import type * as XLSX from "xlsx";

const inputClass =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60";
const buttonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 disabled:cursor-not-allowed";
const fmt = (n: number | null) => (n == null ? "—" : Number(n.toFixed(2)).toString());
export function ClassRecord({
  courseId,
  courseCode,
  quarter = 1,
  roster,
  visibleRoster = roster,
  editable = false,
  onDirtyChange,
}: {
  courseId: string;
  courseCode: string;
  quarter?: number;
  roster: Profile[];
  visibleRoster?: Profile[];
  editable?: boolean;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
}) {
  const query = useQuery({
    queryKey: ["class-record", courseId, quarter],
    queryFn: () => getClassRecord(courseId, quarter),
    enabled: !!courseId,
    retry: false,
  });
  if (query.isPending)
    return (
      <p role="status" className="py-10 text-muted-foreground">
        Loading class record…
      </p>
    );
  if (query.isError)
    return (
      <div role="alert" className="rounded-xl border border-destructive p-5">
        <p>Could not load the class record. Your saved grades are unchanged.</p>
        <button
          type="button"
          className={cn(buttonClass, "mt-3")}
          onClick={() => void query.refetch()}
        >
          Try again
        </button>
      </div>
    );
  return (
    <RecordEditor
      key={`${courseId}:${quarter}`}
      courseId={courseId}
      courseCode={courseCode}
      quarter={quarter}
      roster={roster}
      visibleRoster={visibleRoster}
      editable={editable}
      initial={query.data.draft}
      initialRevision={query.data.revision}
      sources={query.data.sources}
      scale={query.data.scale}
      onDirtyChange={onDirtyChange}
    />
  );
}
function RecordEditor({
  courseId,
  courseCode,
  quarter,
  roster,
  visibleRoster,
  editable,
  initial,
  initialRevision,
  sources,
  scale,
  onDirtyChange,
}: {
  courseId: string;
  courseCode: string;
  quarter: number;
  roster: Profile[];
  visibleRoster: Profile[];
  editable: boolean;
  initial: RecordDraft;
  initialRevision: number;
  sources: RecordSource[];
  scale: RecordScale;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [revision, setRevision] = useState(initialRevision);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm("Leave this class record and discard unsaved changes?"),
    enableBeforeUnload: dirty,
  });
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<RecordCategory>("ww");
  const [maximum, setMaximum] = useState("100");
  const [sourceKey, setSourceKey] = useState("manual");
  const [reason, setReason] = useState("");
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [sessionDate, setSessionDate] = useState("");
  const [importBook, setImportBook] = useState<XLSX.WorkBook | null>(null);
  const [importFile, setImportFile] = useState("");
  const [importSheet, setImportSheet] = useState("");
  const [importPreview, setImportPreview] = useState<RecordImportPreview | null>(null);
  const [replaceImport, setReplaceImport] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const update = (fn: (d: RecordDraft) => void) => {
    setDraft((prev) => {
      const d = structuredClone(prev);
      fn(d);
      return d;
    });
    setDirty(true);
  };
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const columns = useMemo(
    () =>
      [...draft.columns].sort(
        (a, b) => ["ww", "ex", "pt"].indexOf(a.category) - ["ww", "ex", "pt"].indexOf(b.category),
      ),
    [draft.columns],
  );
  const results = visibleRoster.map((student) => ({
    student,
    result: calculateRecord(draft, sources, student.id, scale),
  }));
  const available = sources.filter(
    (s) => !draft.columns.some((c) => c.source?.id === s.id && c.source.kind === s.kind),
  );
  const addColumn = () => {
    const source = available.find((s) => `${s.kind}:${s.id}` === sourceKey);
    const max = Number(source?.maximum ?? maximum);
    const name = source?.title ?? title.trim();
    if (!name || !Number.isFinite(max) || max <= 0 || max > 100000) {
      toast.error("Enter a title and a maximum greater than zero.");
      return;
    }
    update((d) =>
      d.columns.push({
        id: crypto.randomUUID(),
        title: name,
        category,
        maximum: max,
        ...(source ? { source: { kind: source.kind, id: source.id } } : {}),
      }),
    );
    setTitle("");
    setSourceKey("manual");
  };
  const save = async (publishIds: string[]) => {
    setBusy(true);
    try {
      const result = await saveClassRecord({ courseId, quarter, revision, draft, publishIds });
      setRevision(result.revision);
      setDirty(false);
      qc.setQueryData(
        ["class-record", courseId, quarter],
        (old: Awaited<ReturnType<typeof getClassRecord>> | undefined) =>
          old ? { ...old, draft: structuredClone(draft), revision: result.revision } : old,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["course-grades", courseId, quarter] }),
        qc.invalidateQueries({ queryKey: ["grades"] }),
      ]);
      toast.success(
        publishIds.length
          ? `Published ${result.published} student record${result.published === 1 ? "" : "s"}.`
          : "Draft saved. Student grades have not changed.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save class record.");
    } finally {
      setBusy(false);
    }
  };
  const exportSheet = async (format: "xlsx" | "csv", blank = false) => {
    const XLSX = await import("xlsx");
    const data = recordSheetRows(draft, sources, blank ? [] : visibleRoster, scale);
    const rows = blank
      ? [...data.rows, ...visibleRoster.map((s) => [s.student_id ?? "", s.full_name])]
      : data.rows;
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 18 },
      { wch: 32 },
      ...Array.from({ length: (rows[1]?.length ?? 3) - 2 }, () => ({ wch: 18 })),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Class Record");
    const filename = `${courseCode}-period-${quarter}${blank ? "-template" : "-class-record"}`;
    if (format === "csv")
      downloadCsv(
        XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as (string | number)[][],
        `${filename}.csv`,
      );
    else
      downloadBlob(
        new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `${filename}.xlsx`,
      );
  };
  const readImport = async (file: File) => {
    if (file.size > 10_000_000) {
      toast.error("Use a spreadsheet smaller than 10 MB.");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      setImportBook(wb);
      setImportFile(file.name);
      setImportSheet(wb.SheetNames[0] ?? "");
      setImportPreview(null);
      setReplaceImport(false);
    } catch {
      toast.error("Could not read this spreadsheet.");
    }
  };
  const print = () => {
    // Print a dedicated document so the sidebar and other gradebook tabs never enter the record.
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Allow pop-ups to print the class record.");
      return;
    }
    const escape = (s: unknown) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
      );
    const rows = recordSheetRows(draft, sources, visibleRoster, scale).rows;
    win.document.write(
      `<!doctype html><html><head><title>${escape(courseCode)} Class Record</title><style>@page{size:landscape;margin:10mm}body{font:10px sans-serif}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:5px;text-align:right}th{background:#eee}td:nth-child(2){text-align:left}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><h1>${escape(courseCode)} — ${escape(termLabel(quarter, { education_level: scale === "college" ? "college" : "jhs" }))}</h1><p>Attendance 10% · Written Works 20% · Quarterly Examination 30% · Performance Tasks 40%. ${escape(scale === "college" ? "College 1.00–5.00 scale" : "DepEd transmutation")}. ${dirty ? "Unsaved draft" : "Saved draft"}; incomplete records are provisional.</p><table><thead>${rows
        .slice(0, 3)
        .map((r) => `<tr>${r.map((c) => `<th>${escape(c)}</th>`).join("")}</tr>`)
        .join("")}</thead><tbody>${rows
        .slice(3)
        .map(
          (r) =>
            `<tr>${r.map((c) => `<td>${escape(typeof c === "number" ? fmt(c) : c)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table></body></html>`,
    );
    win.document.close();
    win.focus();
    win.print();
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{courseCode} class record</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {scale === "college" ? "College 1.00–5.00 scale" : "DepEd transmutation"} ·{" "}
            {dirty ? "Unsaved changes" : "Saved draft"} · Revision {revision}. Blank scores remain
            incomplete.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => void exportSheet("csv")}>
            <Download className="h-4 w-4" />
            CSV
          </button>
          <button type="button" className={buttonClass} onClick={() => void exportSheet("xlsx")}>
            <FileSpreadsheet className="h-4 w-4" />
            Excel
          </button>
          <button type="button" className={buttonClass} onClick={print}>
            <Printer className="h-4 w-4" />
            Print
          </button>
          {editable && (
            <>
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => void save([])}
              >
                <Save className="h-4 w-4" />
                Save draft
              </button>
              <button
                type="button"
                className={cn(
                  buttonClass,
                  "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
                )}
                disabled={
                  busy ||
                  !selection.length ||
                  results.some((r) => selection.includes(r.student.id) && !r.result.complete)
                }
                onClick={() => {
                  if (
                    window.confirm(
                      `Publish grades for ${selection.length} selected students? Students will see these grades.`,
                    )
                  )
                    void save(selection);
                }}
              >
                <Send className="h-4 w-4" />
                {busy ? "Saving…" : `Publish selected (${selection.length})`}
              </button>
            </>
          )}
        </div>
      </div>
      {editable && (
        <fieldset disabled={busy} className="space-y-4 rounded-xl border border-border p-4">
          <legend className="px-2 text-sm font-semibold">Assessments and period</legend>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              Period start
              <input
                type="date"
                className={cn(inputClass, "block")}
                value={draft.start}
                onChange={(e) =>
                  update((d) => {
                    d.start = e.target.value;
                  })
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              Period end
              <input
                type="date"
                className={cn(inputClass, "block")}
                value={draft.end}
                min={draft.start}
                onChange={(e) =>
                  update((d) => {
                    d.end = e.target.value;
                  })
                }
              />
            </label>
            <button
              type="button"
              className={buttonClass}
              aria-expanded={attendanceOpen}
              onClick={() => setAttendanceOpen(!attendanceOpen)}
            >
              Record class attendance
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => void exportSheet("xlsx", true)}
            >
              Blank template
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => importRef.current?.click()}
            >
              <FileUp className="h-4 w-4" />
              Import scores
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".xlsx,.xls,.csv,.tsv"
              className="hidden"
              aria-label="Import class record spreadsheet"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readImport(file);
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              Assessment source
              <select
                className={cn(inputClass, "block max-w-72")}
                value={sourceKey}
                onChange={(e) => setSourceKey(e.target.value)}
              >
                <option value="manual">Manual / offline assessment</option>
                {available.map((s) => (
                  <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              Category
              <select
                className={cn(inputClass, "block")}
                value={category}
                onChange={(e) => setCategory(e.target.value as RecordCategory)}
              >
                <option value="ww">Written Works (20%)</option>
                <option value="ex">Quarterly Examination (30%)</option>
                <option value="pt">Performance Tasks (40%)</option>
              </select>
            </label>
            {sourceKey === "manual" && (
              <>
                <label className="space-y-1 text-sm">
                  Column title
                  <input
                    className={cn(inputClass, "block w-36")}
                    placeholder={category === "ww" ? "Q1" : category === "pt" ? "PT1" : "Exam"}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  Maximum
                  <input
                    type="number"
                    min="0.01"
                    max="100000"
                    step="any"
                    className={cn(inputClass, "block w-28")}
                    value={maximum}
                    onChange={(e) => setMaximum(e.target.value)}
                  />
                </label>
              </>
            )}
            <button type="button" className={buttonClass} onClick={addColumn}>
              <Plus className="h-4 w-4" />
              Add column
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={!available.some((s) => s.maximum > 0)}
              onClick={() =>
                update((d) => {
                  for (const s of available.filter((s) => s.maximum > 0))
                    d.columns.push({
                      id: crypto.randomUUID(),
                      title: s.title,
                      category:
                        s.kind === "assignment" ? "pt" : /exam/i.test(s.title) ? "ex" : "ww",
                      maximum: s.maximum,
                      source: { id: s.id, kind: s.kind },
                    });
                })
              }
            >
              Load LMS assessments
            </button>
          </div>
          <label className="block max-w-xl text-sm">
            Reason for score / attendance overrides
            <input
              className={cn(inputClass, "mt-1 block w-full")}
              placeholder="Required when changing an automatic score or attendance percentage"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Review the category and period of every linked assessment before publishing. Clear an
            overridden score to restore its automatic value. Attendance overrides also require a
            reason.
          </p>
        </fieldset>
      )}
      {importBook && (
        <section
          className="space-y-3 rounded-xl border border-border p-4"
          aria-label="Import preview"
        >
          <h3 className="font-semibold">Import {importFile}</h3>
          <div className="flex flex-wrap gap-3">
            <select
              aria-label="Worksheet"
              className={inputClass}
              value={importSheet}
              onChange={(e) => {
                setImportSheet(e.target.value);
                setImportPreview(null);
              }}
            >
              {importBook.SheetNames.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                setImportPreview(
                  previewRecordImport(importBook, importSheet, draft, roster, importFile),
                )
              }
            >
              Preview import
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setImportBook(null);
                setImportPreview(null);
              }}
            >
              Cancel import
            </button>
          </div>
          {importPreview && (
            <>
              <p>
                {importPreview.matched} students matched · {importPreview.changes} scores ·{" "}
                {importPreview.unmatched.length} unmatched rows.
              </p>
              {[...importPreview.errors, ...importPreview.unmatched].length > 0 && (
                <ul className="max-h-48 overflow-auto list-disc pl-5 text-sm" role="status">
                  {[...importPreview.errors, ...importPreview.unmatched].map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={replaceImport}
                  onChange={(e) => setReplaceImport(e.target.checked)}
                />
                Replace the matched nonblank scores shown in this preview; unmatched rows are
                skipped.
              </label>
              <button
                type="button"
                className={buttonClass}
                disabled={
                  !replaceImport || importPreview.errors.length > 0 || importPreview.changes === 0
                }
                onClick={() => {
                  setDraft(importPreview.draft);
                  setDirty(true);
                  setImportBook(null);
                  setImportPreview(null);
                  toast.success("Imported into the draft. Review before publishing.");
                }}
              >
                Apply to draft
              </button>
            </>
          )}
        </section>
      )}
      {editable && attendanceOpen && (
        <section
          className="space-y-3 rounded-xl border border-border p-4"
          aria-label="Class attendance"
        >
          <h3 className="font-semibold">Class attendance</h3>
          <p className="text-sm text-muted-foreground">
            Only held sessions within the period count. Present/excused: 100%; late: 85%; absent:
            0%. Unmarked sessions remain incomplete.
          </p>
          <div className="flex gap-2">
            <input
              type="date"
              aria-label="New session date"
              className={inputClass}
              value={sessionDate}
              min={draft.start}
              max={draft.end}
              onChange={(e) => setSessionDate(e.target.value)}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={
                !sessionDate ||
                !draft.start ||
                !draft.end ||
                sessionDate < draft.start ||
                sessionDate > draft.end
              }
              onClick={() => {
                update((d) =>
                  d.sessions.push({
                    id: crypto.randomUUID(),
                    date: sessionDate,
                    cancelled: false,
                    marks: {},
                  }),
                );
                setSessionDate("");
              }}
            >
              Add class session
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Student</th>
                  {draft.sessions.map((s) => (
                    <th className="min-w-36 p-2" key={s.id}>
                      <span>{s.date}</span>
                      <label className="mt-1 flex items-center justify-center gap-1 text-xs font-normal">
                        <input
                          type="checkbox"
                          checked={s.cancelled}
                          onChange={(e) =>
                            update((d) => {
                              d.sessions.find((x) => x.id === s.id)!.cancelled = e.target.checked;
                            })
                          }
                        />
                        Cancelled
                      </label>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRoster.map((s) => (
                  <tr key={s.id}>
                    <th className="p-2 text-left font-medium">{s.full_name}</th>
                    {draft.sessions.map((session) => (
                      <td className="p-2" key={session.id}>
                        <select
                          aria-label={`${s.full_name} attendance ${session.date}`}
                          className={inputClass}
                          disabled={session.cancelled}
                          value={session.marks[s.id] ?? ""}
                          onChange={(e) =>
                            update((d) => {
                              const marks = d.sessions.find((x) => x.id === session.id)!.marks;
                              if (e.target.value) marks[s.id] = e.target.value as SessionStatus;
                              else delete marks[s.id];
                            })
                          }
                        >
                          <option value="">Unmarked</option>
                          {["present", "late", "excused", "absent"].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!columns.length && (
        <EmptyState
          title="Set up the class record"
          sub="Load LMS assessments or add quiz, examination, and performance-task columns. Then enter class attendance and review the scores."
        />
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums" aria-label="Weighted class record">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th
                rowSpan={3}
                className="sticky left-0 z-10 min-w-40 sm:min-w-56 bg-card p-3 text-left"
              >
                {editable && (
                  <input
                    type="checkbox"
                    className="mr-2"
                    aria-label="Select all visible students"
                    checked={
                      visibleRoster.length > 0 &&
                      visibleRoster.every((s) => selection.includes(s.id))
                    }
                    onChange={(e) =>
                      setSelection(e.target.checked ? visibleRoster.map((s) => s.id) : [])
                    }
                  />
                )}
                Student
              </th>
              <th rowSpan={2} className="p-3">
                Attendance
                <br />
                10%
              </th>
              {(
                [
                  ["ww", "Written Works · 20%"],
                  ["ex", "Quarterly Examination · 30%"],
                  ["pt", "Performance Tasks · 40%"],
                ] as const
              ).map(([cat, label]) => (
                <th
                  key={cat}
                  colSpan={columns.filter((c) => c.category === cat).length + 1}
                  className="border-l border-border px-4 py-3 text-center"
                >
                  {label}
                </th>
              ))}
              <th colSpan={5} className="border-l border-border p-3">
                Percentage
              </th>
              <th rowSpan={3} className="p-3">
                Final grade
              </th>
              <th rowSpan={3} className="p-3">
                Remarks / missing scores
              </th>
            </tr>
            <tr className="border-b border-border">
              {(["ww", "ex", "pt"] as const).map((cat) => (
                <CategoryHeaders
                  key={cat}
                  category={cat}
                  columns={columns}
                  editable={editable && !busy}
                  onRemove={(id) => {
                    if (
                      window.confirm(
                        "Remove this column from the draft? Published grades stay unchanged until republished.",
                      )
                    )
                      update((d) => {
                        d.columns = d.columns.filter((c) => c.id !== id);
                        for (const scores of Object.values(d.scores)) delete scores[id];
                      });
                  }}
                />
              ))}
              {["Attendance", "Written Works", "Exam", "PT", "Total"].map((t) => (
                <th key={t} className="min-w-24 p-2">
                  {t}
                </th>
              ))}
            </tr>
            <tr className="border-b border-border bg-muted/30">
              <th className="p-2 text-xs text-muted-foreground">Maximum 100</th>
              {(["ww", "ex", "pt"] as const).map((cat) => (
                <CategoryMaxima key={cat} category={cat} columns={columns} />
              ))}
              {[10, 20, 30, 40, 100].map((n) => (
                <th key={n} className="p-2 text-xs text-muted-foreground">
                  {n}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {results.map(({ student: s, result: r }) => (
              <tr key={s.id} className="hover:bg-muted/20">
                <th className="sticky left-0 z-10 bg-card p-3 text-left font-medium">
                  {editable && (
                    <input
                      type="checkbox"
                      className="mr-2"
                      aria-label={`Select ${s.full_name}`}
                      checked={selection.includes(s.id)}
                      onChange={(e) =>
                        setSelection((ids) =>
                          e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id),
                        )
                      }
                    />
                  )}
                  <span>{s.full_name}</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {s.student_id} · {s.section}
                  </span>
                </th>
                <td className="p-2 text-center">
                  <ScoreInput
                    label={`${s.full_name} attendance percentage`}
                    editable={editable && !busy}
                    value={r.attendance}
                    maximum={100}
                    overridden={!!draft.attendance[s.id]}
                    onChange={(value) =>
                      update((d) => {
                        if (value == null) delete d.attendance[s.id];
                        else
                          d.attendance[s.id] = {
                            value,
                            ...(reason.trim() ? { reason: reason.trim() } : {}),
                          };
                      })
                    }
                  />
                </td>
                {(["ww", "ex", "pt"] as const).map((cat) => (
                  <CategoryCells
                    key={cat}
                    category={cat}
                    columns={columns}
                    draft={draft}
                    sources={sources}
                    student={s}
                    editable={editable && !busy}
                    onChange={(id, value) =>
                      update((d) => {
                        d.scores[s.id] ??= {};
                        if (value == null) delete d.scores[s.id]![id];
                        else
                          d.scores[s.id]![id] = {
                            value,
                            ...(reason.trim() ? { reason: reason.trim() } : {}),
                          };
                      })
                    }
                  />
                ))}
                {[
                  r.contributions.attendance,
                  r.contributions.ww,
                  r.contributions.ex,
                  r.contributions.pt,
                  r.initial,
                ].map((n, i) => (
                  <td className={cn("p-3 text-center", i === 4 && "font-semibold")} key={i}>
                    {fmt(n)}
                    {i === 4 && !r.complete && (
                      <span className="block text-xs text-muted-foreground">Provisional</span>
                    )}
                  </td>
                ))}
                <td className="p-3 text-center font-semibold">
                  {r.complete ? (scale === "college" ? r.final.toFixed(2) : r.final) : "—"}
                </td>
                <td className="min-w-48 p-3 text-xs">
                  {r.complete ? r.remarks : `Incomplete: ${r.missing.join(", ")}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted-foreground">
        {visibleRoster.length} student{visibleRoster.length === 1 ? "" : "s"} shown. Scroll
        horizontally for all scores and totals. Category percentages use total earned ÷ total
        possible. Each linked assessment uses the student’s effective score; IT10 keeps the highest
        retake percentage. Student grades change only after publication.
      </p>
    </div>
  );
}
function CategoryHeaders({
  category,
  columns,
  editable,
  onRemove,
}: {
  category: RecordCategory;
  columns: RecordDraft["columns"];
  editable: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      {columns
        .filter((c) => c.category === category)
        .map((c) => (
          <th className="min-w-28 p-2" key={c.id}>
            <span>{c.title}</span>
            <span className="block text-xs font-normal text-muted-foreground">
              {c.source ? "LMS" : "Manual"}
            </span>
            {editable && (
              <button
                type="button"
                className="mt-1 rounded p-1 text-muted-foreground hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Remove ${c.title}`}
                onClick={() => onRemove(c.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </th>
        ))}
      <th className="min-w-24 bg-muted/30 p-2">
        {category === "ww" ? "Total Quiz" : category === "pt" ? "Total PT" : "Total Exam"}
      </th>
    </>
  );
}
function CategoryMaxima({
  category,
  columns,
}: {
  category: RecordCategory;
  columns: RecordDraft["columns"];
}) {
  return (
    <>
      {columns
        .filter((c) => c.category === category)
        .map((c) => (
          <th key={c.id} className="p-2 text-xs text-muted-foreground">
            {c.maximum}
          </th>
        ))}
      <th className="p-2 text-xs text-muted-foreground">
        {columns.filter((c) => c.category === category).reduce((s, c) => s + c.maximum, 0)}
      </th>
    </>
  );
}
function CategoryCells({
  category,
  columns,
  draft,
  sources,
  student,
  editable,
  onChange,
}: {
  category: RecordCategory;
  columns: RecordDraft["columns"];
  draft: RecordDraft;
  sources: RecordSource[];
  student: Profile;
  editable: boolean;
  onChange: (id: string, value: number | null) => void;
}) {
  const cols = columns.filter((c) => c.category === category);
  let total = 0;
  return (
    <>
      {cols.map((c) => {
        const value = recordCell(draft, sources, student.id, c);
        total += value ?? 0;
        return (
          <td key={c.id} className="p-2 text-center">
            <ScoreInput
              label={`${student.full_name} ${c.title}`}
              value={value}
              maximum={c.maximum}
              editable={editable}
              overridden={!!c.source && !!draft.scores[student.id]?.[c.id]}
              onChange={(v) => onChange(c.id, v)}
            />
          </td>
        );
      })}
      <td className="bg-muted/20 p-3 text-center font-semibold">{fmt(total)}</td>
    </>
  );
}
function ScoreInput({
  label,
  value,
  maximum,
  editable,
  overridden,
  onChange,
}: {
  label: string;
  value: number | null;
  maximum: number;
  editable: boolean;
  overridden: boolean;
  onChange: (n: number | null) => void;
}) {
  if (!editable) return <span>{fmt(value)}</span>;
  return (
    <div>
      <input
        aria-label={label}
        title={overridden ? "Teacher override. Clear to restore automatic score." : label}
        type="number"
        step="any"
        min={0}
        max={maximum}
        className={cn(inputClass, "w-24 text-center", overridden && "border-primary")}
        value={value == null ? "" : Number(value.toFixed(6))}
        onChange={(e) => {
          const n = e.target.value === "" ? null : Number(e.target.value);
          if (n == null || (Number.isFinite(n) && n >= 0 && n <= maximum)) onChange(n);
        }}
      />
      {overridden && <span className="mt-1 block text-xs text-primary">Override</span>}
    </div>
  );
}
