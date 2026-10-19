import { Fragment, useEffect, useRef, useState } from "react";
import { createFileRoute, useRouter, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  FileSpreadsheet,
  FileUp,
  LogIn,
  LogOut,
  Nfc,
  Trash2,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { LoadingSkeleton, UserAvatar } from "@/components/ui-elements";
import { AttendanceImportModal } from "@/components/courses/attendance-import-modal";
import { exportAttendanceCsv, exportAttendanceXlsx } from "@/lib/attendance-import";
import {
  ATTENDANCE_LIMIT_KIOSK,
  ATTENDANCE_LIMIT_REPORTS,
  SCAN_BANNER_DISMISS_MS,
} from "@/components/courses/constants";
import {
  createMockTapPayload,
  deleteAttendanceLog,
  fmtDate,
  fmtTime,
  listAllAttendance,
  listStudents,
  recordTap,
  updateAttendanceLog,
  type AttendanceLog,
  type AttendanceStatus,
  type Profile,
  type TapPayload,
  type TapResult,
} from "@/lib/lms";
import {
  ADMIN_NAV,
  TEACHER_NAV,
  AppShell,
  Badge,
  Card,
  FilterTabs,
  attendanceTone,
  useProfile,
  useRfidScanner,
} from "@/components/lms";
import { cn } from "@/lib/utils";
import { KIOSK_EVENT_HEADER, KIOSK_TITLE } from "@/lib/brand";
import { MiowMark } from "@/components/brand";

export const Route = createFileRoute("/dashboard/admin/attendance")({
  // ?view=logs deep-links the Logs & Reports tab; kiosk is the default.
  validateSearch: (search: Record<string, unknown>): { view?: "logs" | undefined } => ({
    view: search["view"] === "logs" ? "logs" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Attendance | MIOW - Integrated Developmental School" },
      {
        name: "description",
        content: "Attendance kiosk and logs: RFID tap-in/tap-out, live feed, and scan history.",
      },
      {
        property: "og:title",
        content: "Attendance | MIOW - Integrated Developmental School",
      },
      {
        property: "og:description",
        content: "Attendance kiosk and logs: RFID tap-in/tap-out, live feed, and scan history.",
      },
    ],
  }),
  component: AttendanceKiosk,
});

type FeedFilter = "all" | "in" | "out" | "late";
type AttendanceView = "kiosk" | "logs";

/** Short confirmation tone — success chirp or error buzz. */
function playTone(ok: boolean, muted: boolean) {
  if (muted) return;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = ok ? [660, 990] : [220, 180];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = ok ? "sine" : "square";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.14);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    /* audio unavailable */
  }
}

/** One attendance log row — shared by today's kiosk feed and the logs view. */
function LogRow({
  log,
  name,
  onStatus,
  onDelete,
}: {
  log: AttendanceLog;
  name?: string | undefined;
  onStatus: (id: string, status: AttendanceStatus) => void;
  onDelete: (id: string) => void;
}) {
  const t = attendanceTone(log.status);
  return (
    <div className="flex items-center gap-3 p-3.5">
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-xl",
          log.scan_type === "in"
            ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
            : "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
        )}
      >
        {log.scan_type === "in" ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name ?? "Unknown"}</p>
        <p className="text-xs text-muted-foreground">{fmtTime(log.timestamp)}</p>
      </div>
      {log.scan_type === "in" ? (
        <select
          value={log.status}
          onChange={(e) => onStatus(log.id, e.target.value as AttendanceStatus)}
          aria-label="Attendance status override"
          title="Manual override"
          className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="on-time">On time</option>
          <option value="late">Late</option>
          <option value="excused">Excused</option>
        </select>
      ) : (
        <Badge tone={t.tone}>{t.label}</Badge>
      )}
      <button
        onClick={() => onDelete(log.id)}
        aria-label="Delete attendance record"
        title="Delete record"
        className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function AttendanceKiosk() {
  const profile = useProfile(["admin", "teacher"]);
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { view?: unknown };
  const router = useRouter();
  const view: AttendanceView = search.view === "logs" ? "logs" : "kiosk";
  const setView = (v: AttendanceView) =>
    void router.navigate({
      to: ".",
      search: (prev) => ({
        ...(prev as Record<string, unknown>),
        view: v === "logs" ? "logs" : undefined,
      }),
      replace: true,
    });
  const { data: logs } = useQuery({
    queryKey: ["attendance-all"],
    queryFn: () => listAllAttendance(ATTENDANCE_LIMIT_KIOSK),
    enabled: !!profile,
  });
  // Wider history for the Logs & Reports view (auto-refreshed alongside "attendance-all").
  const { data: reportLogs } = useQuery({
    queryKey: ["attendance-all", "reports"],
    queryFn: () => listAllAttendance(ATTENDANCE_LIMIT_REPORTS),
    enabled: !!profile && view === "logs",
  });
  const { data: students } = useQuery({
    queryKey: ["students"],
    queryFn: listStudents,
    enabled: !!profile,
  });

  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);
  // Synchronous reentrancy guard for handleTapPayload (see below).
  const tapGuard = useRef(false);
  const [muted, setMuted] = useState(false);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [reportFilter, setReportFilter] = useState<FeedFilter>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [lastScan, setLastScan] = useState<{
    profile: Profile;
    scan_type: "in" | "out";
    status: string;
    course?: TapResult["course"];
  } | null>(null);

  // Auto-dismiss the scan banner
  useEffect(() => {
    if (!lastScan) return;
    const t = setTimeout(() => setLastScan(null), SCAN_BANNER_DISMISS_MS);
    return () => clearTimeout(t);
  }, [lastScan]);

  /** Process one reader payload ({ uid, timestamp }) — shared by the hardware
   * scanner, the manual form, and the simulated mock reader. */
  const handleTapPayload = async (payload: TapPayload, mock = false) => {
    // Synchronous reentrancy guard: `busy` is async state, so two invocations in
    // the same tick (a double Enter firing both the scanner and the form submit)
    // both see a stale `busy === false` and record a spurious in+out pair. The
    // ref flips immediately and is reset in `finally`, so exactly one tap is
    // processed per Enter.
    if (tapGuard.current) return;
    tapGuard.current = true;
    setBusy(true);
    if (mock) {
      // UI status feedback that the mock dispatcher's payload was received.
      toast.info(`Mock tap received — ${payload.uid}`, {
        description: `Dispatched ${new Date(payload.timestamp).toLocaleTimeString()}`,
      });
    }
    try {
      const result = await recordTap({ uid: payload.uid.trim(), timestamp: payload.timestamp });
      if (!result) {
        playTone(false, muted);
        toast.error(`Card not recognized (${payload.uid.trim()}).`);
        return;
      }
      playTone(true, muted);
      setLastScan({
        profile: result.profile,
        scan_type: result.scan_type,
        status: result.status,
        course: result.course,
      });
      qc.invalidateQueries({ queryKey: ["attendance-all"] });
    } catch {
      playTone(false, muted);
      toast.error("Scan failed — try again.");
    } finally {
      tapGuard.current = false;
      setBusy(false);
      setUid("");
    }
  };

  useRfidScanner(
    (code) => void handleTapPayload({ uid: code, timestamp: new Date().toISOString() }),
    !!profile,
  );

  const isLoading = !logs || !students;

  if (!profile) return null;

  const nav = profile.role === "admin" ? ADMIN_NAV : TEACHER_NAV;
  const subtitle = profile.role === "admin" ? "Admin Console" : "Teacher Portal";

  if (isLoading)
    return (
      <AppShell nav={nav} profile={profile} subtitle={subtitle}>
        <LoadingSkeleton />
      </AppShell>
    );

  const today = new Date().toDateString();
  const todayLogs = (logs ?? []).filter((l) => new Date(l.timestamp).toDateString() === today);
  const nameOf = new Map((students ?? []).map((s) => [s.id, s]));

  const feedCounts: Record<FeedFilter, number> = {
    all: todayLogs.length,
    in: todayLogs.filter((l) => l.scan_type === "in").length,
    out: todayLogs.filter((l) => l.scan_type === "out").length,
    late: todayLogs.filter((l) => l.scan_type === "in" && l.status === "late").length,
  };
  const visibleLogs = todayLogs.filter((l) => {
    if (filter === "in") return l.scan_type === "in";
    if (filter === "out") return l.scan_type === "out";
    if (filter === "late") return l.scan_type === "in" && l.status === "late";
    return true;
  });

  // Logs & Reports: full fetched history, newest first, grouped by day.
  const history = (reportLogs ?? logs ?? [])
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const reportCounts: Record<FeedFilter, number> = {
    all: history.length,
    in: history.filter((l) => l.scan_type === "in").length,
    out: history.filter((l) => l.scan_type === "out").length,
    late: history.filter((l) => l.scan_type === "in" && l.status === "late").length,
  };
  const visibleHistory = history.filter((l) => {
    if (reportFilter === "in") return l.scan_type === "in";
    if (reportFilter === "out") return l.scan_type === "out";
    if (reportFilter === "late") return l.scan_type === "in" && l.status === "late";
    return true;
  });
  const historyDays: Array<{ key: string; logs: AttendanceLog[] }> = [];
  for (const l of visibleHistory) {
    const key = new Date(l.timestamp).toDateString();
    const last = historyDays[historyDays.length - 1];
    if (last && last.key === key) last.logs.push(l);
    else historyDays.push({ key, logs: [l] });
  }

  const markStatus = async (id: string, status: AttendanceStatus) => {
    try {
      await updateAttendanceLog(id, { status });
      toast.success(`Marked as ${status}.`);
      qc.invalidateQueries({ queryKey: ["attendance-all"] });
    } catch {
      toast.error("Update failed.");
    }
  };

  const removeLog = async (id: string) => {
    try {
      await deleteAttendanceLog(id);
      toast.success("Record deleted.");
      qc.invalidateQueries({ queryKey: ["attendance-all"] });
    } catch {
      toast.error("Delete failed.");
    }
  };

  const handleExportCsv = () => {
    exportAttendanceCsv(visibleHistory, students ?? []);
    toast.success("Exported attendance CSV.");
  };

  const handleExportXlsx = () => {
    exportAttendanceXlsx(visibleHistory, students ?? []);
    toast.success("Exported attendance Excel spreadsheet.");
  };

  return (
    <AppShell nav={nav} profile={profile} subtitle={subtitle}>
      {/* Big scan-result banner */}
      <AnimatePresence>
        {lastScan && (
          <motion.div
            initial={{ opacity: 0, y: -24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.98 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className={cn(
              "fixed left-1/2 top-5 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border p-4 shadow-lift backdrop-blur-xl",
              lastScan.scan_type === "out"
                ? "border-sky-300/60 bg-sky-50/95 dark:border-sky-500/40 dark:bg-sky-950/90"
                : lastScan.status === "late"
                  ? "border-amber-300/60 bg-amber-50/95 dark:border-amber-500/40 dark:bg-amber-950/90"
                  : "border-emerald-300/60 bg-emerald-50/95 dark:border-emerald-500/40 dark:bg-emerald-950/90",
            )}
          >
            <div className="mb-3 flex items-center gap-2 border-b border-border/60 pb-2">
              <MiowMark plate={false} className="h-4 w-4" />
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {KIOSK_EVENT_HEADER}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <UserAvatar
                src={lastScan.profile.avatar_url}
                name={lastScan.profile.full_name}
                className="h-12 w-12 ring-2 ring-white/60"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{lastScan.profile.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {lastScan.profile.student_id} · {lastScan.profile.section}
                </p>
                {lastScan.course && (
                  <p className="truncate text-[11px] font-medium text-muted-foreground">
                    {lastScan.course.code} {lastScan.course.start_time?.slice(0, 5) ?? "??:??"}–
                    {lastScan.course.end_time?.slice(0, 5) ?? "??:??"} · grace{" "}
                    {lastScan.course.late_threshold_minutes}m
                  </p>
                )}
              </div>
              <p
                className={cn(
                  "font-display text-lg font-extrabold",
                  lastScan.scan_type === "out"
                    ? "text-sky-600 dark:text-sky-300"
                    : lastScan.status === "late"
                      ? "text-amber-600 dark:text-amber-300"
                      : "text-emerald-600 dark:text-emerald-300",
                )}
              >
                {lastScan.scan_type === "in"
                  ? lastScan.status === "late"
                    ? "LATE"
                    : "ON TIME"
                  : "OUT"}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Kiosk vs. Logs & Reports view switcher */}
      <div className="mb-6">
        <FilterTabs<AttendanceView>
          value={view}
          onChange={setView}
          options={[
            { value: "kiosk", label: "Kiosk" },
            { value: "logs", label: "Logs & Reports" },
          ]}
        />
      </div>

      {view === "kiosk" ? (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold sm:text-3xl">{KIOSK_TITLE}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Students tap their RFID ID at the gate. On-time vs late is evaluated against today's
                class schedule (each course's grace period); with no scheduled class, the 7:30 AM
                gate cutoff applies. Absent = no tap within the session window.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10"
                title="Import attendance records from Excel or CSV"
              >
                <FileUp className="h-4 w-4" /> Import
              </button>
              <button
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute scan sounds" : "Mute scan sounds"}
                title={muted ? "Unmute scan sounds" : "Mute scan sounds"}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold hover:bg-muted"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                {muted ? "Muted" : "Sound on"}
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <Card className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
                <Nfc className="h-10 w-10" />
                <p className="text-sm font-semibold">RFID Kiosk</p>
                <p className="text-xs">Tap a card or enter a UID below</p>
              </Card>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (uid.trim()) {
                    void handleTapPayload({ uid, timestamp: new Date().toISOString() });
                  }
                }}
                className="flex gap-2"
              >
                <div className="relative flex-1">
                  <Nfc className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={uid}
                    onChange={(e) => setUid(e.target.value)}
                    aria-label="RFID UID"
                    placeholder="RFID UID — or just tap a card"
                    className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  Tap
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label="Simulate RFID tap"
                  title="Dispatch a simulated reader payload"
                  onClick={() => {
                    const sampleUid = uid.trim() || students?.find((s) => s.rfid_uid)?.rfid_uid;
                    void handleTapPayload(createMockTapPayload(sampleUid || undefined), true);
                  }}
                  className="flex h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
                >
                  <Zap className="h-4 w-4" /> Simulate
                </button>
              </form>
            </div>

            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold">Today's feed</h2>
                <FilterTabs<FeedFilter>
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "All" },
                    { value: "in", label: "In" },
                    { value: "out", label: "Out" },
                    { value: "late", label: "Late" },
                  ]}
                  counts={feedCounts}
                />
              </div>
              <Card className="custom-scrollbar max-h-[560px] divide-y divide-border overflow-y-auto">
                {visibleLogs.length === 0 && (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    {todayLogs.length === 0
                      ? "No taps yet today."
                      : "No records match this filter."}
                  </p>
                )}
                {visibleLogs.map((l) => (
                  <LogRow
                    key={l.id}
                    log={l}
                    name={nameOf.get(l.student_id)?.full_name}
                    onStatus={markStatus}
                    onDelete={removeLog}
                  />
                ))}
              </Card>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold sm:text-3xl">Attendance logs</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Full scan history, newest first. Override a status or delete a record where needed.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10"
                title="Import attendance records from Excel or CSV"
              >
                <FileUp className="h-4 w-4" /> Import
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={visibleHistory.length === 0}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
                title="Export logs as CSV"
              >
                <Download className="h-4 w-4" /> CSV
              </button>
              <button
                type="button"
                onClick={handleExportXlsx}
                disabled={visibleHistory.length === 0}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
                title="Export logs as Excel spreadsheet"
              >
                <FileSpreadsheet className="h-4 w-4" /> Excel
              </button>
            </div>
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold">History</h2>
              <FilterTabs<FeedFilter>
                value={reportFilter}
                onChange={setReportFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "in", label: "In" },
                  { value: "out", label: "Out" },
                  { value: "late", label: "Late" },
                ]}
                counts={reportCounts}
              />
            </div>
            <Card className="custom-scrollbar max-h-[560px] divide-y divide-border overflow-y-auto">
              {historyDays.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {history.length === 0
                    ? "No attendance records yet."
                    : "No records match this filter."}
                </p>
              )}
              {historyDays.map((day) => {
                const dayIn = day.logs.filter((l) => l.scan_type === "in").length;
                const dayOut = day.logs.length - dayIn;
                const dayLate = day.logs.filter(
                  (l) => l.scan_type === "in" && l.status === "late",
                ).length;
                return (
                  <Fragment key={day.key}>
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-3.5 py-2">
                      <p className="text-xs font-bold uppercase tracking-wide">
                        {fmtDate(day.logs[0]?.timestamp ?? null)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {day.logs.length} scan{day.logs.length === 1 ? "" : "s"} · {dayIn} in ·{" "}
                        {dayOut} out · {dayLate} late
                      </p>
                    </div>
                    {day.logs.map((l) => (
                      <LogRow
                        key={l.id}
                        log={l}
                        name={nameOf.get(l.student_id)?.full_name}
                        onStatus={markStatus}
                        onDelete={removeLog}
                      />
                    ))}
                  </Fragment>
                );
              })}
            </Card>
          </div>
        </>
      )}

      <AttendanceImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        students={students ?? []}
        existingLogs={history}
        onImportComplete={() => {
          qc.invalidateQueries({ queryKey: ["attendance-all"] });
        }}
      />
    </AppShell>
  );
}
