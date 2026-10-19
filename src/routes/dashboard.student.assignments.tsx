import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ASSIGNMENT_MAX_BYTES } from "@/components/courses/constants";
import { setAssessmentMode } from "@/lib/assessment-mode";
import { Dropzone } from "@/components/dropzone";
import {
  COMPONENT_LABELS,
  daysUntil,
  fmtDate,
  listAssignments,
  listCourses,
  formatFileSize,
  listSubmissionsForStudent,
  materialHref,
  submitAssignment,
  uploadSubmissionFile,
  type Assignment,
  type Attachment,
} from "@/lib/lms";
import {
  AppShell,
  Badge,
  Card,
  EmptyState,
  FilterTabs,
  Modal,
  MotionCard,
  ProgressBar,
  STUDENT_NAV,
  courseStyle,
  useProfile,
} from "@/components/lms";
import { cn } from "@/lib/utils";
import { LoadingSkeleton } from "@/components/ui-elements";

export const Route = createFileRoute("/dashboard/student/assignments")({
  head: () => ({
    meta: [
      { title: "Activities | MIOW - Integrated Developmental School" },
      { name: "description", content: "View and submit your activities and performance tasks." },
      { property: "og:title", content: "Activities | MIOW - Integrated Developmental School" },
      {
        property: "og:description",
        content: "View and submit your assignments and performance tasks.",
      },
    ],
  }),
  component: AssignmentsPage,
});

type Tab = "all" | "pending" | "submitted" | "graded";

function AssignmentsPage() {
  const profile = useProfile(["student"]);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("all");
  const [target, setTarget] = useState<Assignment | null>(null);
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxMB = Math.round(ASSIGNMENT_MAX_BYTES / (1024 * 1024));

  // Clean up any in-flight progress timer on unmount
  useEffect(() => {
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  // Assessment integrity: hide the ClassMate Assistant while the submission
  // workspace is open (restored when it closes or the page unmounts).
  useEffect(() => {
    setAssessmentMode(!!target);
    return () => setAssessmentMode(false);
  }, [target]);

  const { data: courses } = useQuery({
    queryKey: ["courses"],
    queryFn: listCourses,
    enabled: !!profile,
  });
  const { data: assignments } = useQuery({
    queryKey: ["assignments"],
    queryFn: listAssignments,
    enabled: !!profile,
  });
  const { data: submissions } = useQuery({
    queryKey: ["submissions", profile?.id],
    queryFn: () => {
      if (!profile?.id) return [];
      return listSubmissionsForStudent(profile.id);
    },
    enabled: !!profile,
  });

  const isLoading = !courses || !assignments || !submissions;

  if (!profile) return null;

  if (isLoading)
    return (
      <AppShell nav={STUDENT_NAV} profile={profile} subtitle="Student Portal">
        <LoadingSkeleton />
      </AppShell>
    );

  // Server returns the enrolled courses only — no client-side scoping needed.
  const myCourses = courses ?? [];
  const courseIds = new Set(myCourses.map((c) => c.id));
  const myAssignments = (assignments ?? []).filter((a) => courseIds.has(a.course_id));
  const subByAssignment = new Map((submissions ?? []).map((s) => [s.assignment_id, s]));

  const statusOf = (a: Assignment): Tab => {
    const s = subByAssignment.get(a.id);
    if (!s || s.status === "pending") return "pending";
    return s.status;
  };

  const counts: Record<Tab, number> = {
    all: myAssignments.length,
    pending: myAssignments.filter((a) => statusOf(a) === "pending").length,
    submitted: myAssignments.filter((a) => statusOf(a) === "submitted").length,
    graded: myAssignments.filter((a) => statusOf(a) === "graded").length,
  };
  const visible = tab === "all" ? myAssignments : myAssignments.filter((a) => statusOf(a) === tab);

  const openSubmit = (a: Assignment) => {
    setTarget(a);
    setContent(subByAssignment.get(a.id)?.content ?? "");
    setFiles([]);
    setProgress(0);
  };

  const submit = async () => {
    if (!target || (!content.trim() && files.length === 0)) return;
    setSaving(true);
    setProgress(0);
    // Simulated upload progress while the RPC(s) are in flight.
    progressTimer.current = setInterval(() => setProgress((p) => Math.min(90, p + 10)), 160);
    try {
      // 1. Create/update the submission row first to obtain its id.
      const { id } = await submitAssignment({
        assignment_id: target.id,
        student_id: profile.id,
        content: content.trim() || null,
        status: "submitted",
        submitted_at: new Date().toISOString(),
      });
      // 2. Upload each attached file against the submission.
      for (const f of files) {
        if (f.size > ASSIGNMENT_MAX_BYTES) {
          toast.error(`${f.name} is too large (max ${maxMB} MB) — skipped.`);
          continue;
        }
        await uploadSubmissionFile(id, f);
      }
      setProgress(100);
      toast.success("Assignment submitted!");
      setTarget(null);
      setContent("");
      setFiles([]);
      qc.invalidateQueries({ queryKey: ["submissions", profile.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed — please try again.");
    } finally {
      if (progressTimer.current) {
        clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
      setSaving(false);
    }
  };

  return (
    <AppShell nav={STUDENT_NAV} profile={profile} subtitle="Student Portal">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">Activities</h1>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        Submit written work and performance tasks before the deadline.
      </p>

      <div className="mb-5">
        <FilterTabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: "All" },
            { value: "pending", label: "To do" },
            { value: "submitted", label: "Submitted" },
            { value: "graded", label: "Graded" },
          ]}
          counts={counts}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={
            tab === "all"
              ? "No assignments posted yet"
              : `Nothing ${tab === "pending" ? "to do" : tab} right now`
          }
          {...(tab === "pending" ? { sub: "You're all caught up — nice work!" } : {})}
        />
      ) : (
        <div className="space-y-3">
          {visible.map((a, i) => {
            const course = myCourses.find((c) => c.id === a.course_id);
            const st = courseStyle(course?.color ?? "indigo");
            const sub = subByAssignment.get(a.id);
            const due = daysUntil(a.due_date);
            const isClosed = a.due_date ? new Date(a.due_date).getTime() < Date.now() : false;
            const done = sub && sub.status !== "pending";
            return (
              <MotionCard key={a.id} delay={Math.min(i * 0.04, 0.3)} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold", st.soft)}>
                        {course?.code}
                      </span>
                      <Badge tone="slate">{COMPONENT_LABELS[a.component_type]}</Badge>
                      <Badge
                        tone={due === "Overdue" ? "red" : due.includes("today") ? "amber" : "sky"}
                      >
                        {due}
                      </Badge>
                    </div>
                    <p className="mt-2 font-semibold">{a.title}</p>
                    {a.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Due {fmtDate(a.due_date)} · {a.total_points} points
                    </p>
                    <MaterialsCard attachments={a.attachments ?? []} />
                  </div>
                  <div className="text-right">
                    {sub?.status === "graded" ? (
                      <div>
                        <p className="font-display text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                          {sub.score}
                          <span className="text-sm text-muted-foreground">/{a.total_points}</span>
                        </p>
                        {sub.feedback && (
                          <p className="mt-1 max-w-48 text-xs text-muted-foreground">
                            “{sub.feedback}”
                          </p>
                        )}
                      </div>
                    ) : done ? (
                      <Badge tone="green">Submitted</Badge>
                    ) : isClosed ? (
                      <Badge tone="red">Submission closed</Badge>
                    ) : (
                      <button
                        onClick={() => openSubmit(a)}
                        className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                      >
                        <Send className="h-3.5 w-3.5" /> Submit
                      </button>
                    )}
                  </div>
                </div>
              </MotionCard>
            );
          })}
        </div>
      )}

      <Modal open={!!target} onClose={() => !saving && setTarget(null)} title={target?.title ?? ""}>
        <p className="mb-3 text-sm text-muted-foreground">{target?.description}</p>
        <p className="mb-3 flex items-center gap-1.5 rounded-xl border border-border/60 bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          Assessment integrity: the ClassMate Assistant is disabled while this workspace is open.
        </p>

        {/* Multi-file dropzone */}
        <Dropzone
          files={files}
          onChange={setFiles}
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.zip"
          maxBytes={ASSIGNMENT_MAX_BYTES}
          className="mb-3"
        />

        {/* Already-submitted files (when reopening a submitted assignment) */}
        <SubmittedFiles files={subByAssignment.get(target?.id ?? "")?.file_urls ?? []} />

        <MaterialsCard attachments={target?.attachments ?? []} />

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          placeholder="Type or paste your answer here…"
          className="w-full rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        {saving && (
          <div className="mt-3">
            <ProgressBar value={progress} />
            <p className="mt-1 text-center text-xs text-muted-foreground">
              {progress < 100 ? "Uploading…" : "Finishing up…"}
            </p>
          </div>
        )}

        <button
          onClick={submit}
          disabled={saving || (!content.trim() && files.length === 0)}
          className="mt-3 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Submitting…" : "Submit assignment"}
        </button>
      </Modal>
    </AppShell>
  );
}

/** Read-only list of files already attached to a submission. */
function SubmittedFiles({ files }: { files: Attachment[] }) {
  if (!files.length) return null;
  return (
    <div className="mb-3 rounded-xl border border-border/60 bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Paperclip className="h-3.5 w-3.5" /> Your submitted files
      </p>
      <ul className="mt-2 grid gap-1.5">
        {files.map((a) => (
          <li
            key={a.path ?? a.url}
            className="flex items-center gap-2 rounded-lg bg-background/70 px-2.5 py-1.5"
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
            <a
              href={materialHref(a as never)}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-xs font-medium text-primary hover:underline"
            >
              {a.name}
            </a>
            <span className="text-[11px] text-muted-foreground">{formatFileSize(a.size)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Read-only "Reference Materials" card listing a teacher's attached handouts. */
function MaterialsCard({
  attachments,
}: {
  attachments: { path: string; name: string; size: number; url: string }[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Paperclip className="h-3.5 w-3.5" /> Reference materials
      </p>
      <ul className="mt-2 grid gap-1.5">
        {attachments.map((a) => (
          <li
            key={a.path}
            className="flex items-center gap-2 rounded-lg bg-background/70 px-2.5 py-1.5"
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
            <a
              href={materialHref(a as never)}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-xs font-medium text-primary hover:underline"
            >
              {a.name}
            </a>
            <span className="text-[11px] text-muted-foreground">{formatFileSize(a.size)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
