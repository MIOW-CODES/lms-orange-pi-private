import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Paperclip, Save, Search } from "lucide-react";
import {
  fmtDate,
  formatFileSize,
  gradeSubmission,
  listSubmissionsForAssignment,
  materialHref,
  type AssignmentSubmission,
} from "@/lib/lms";
import { Badge, EmptyState } from "@/components/lms";
import { UserAvatar } from "@/components/ui-elements";
import { sanitizeDecimal } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_TONE: Record<AssignmentSubmission["status"], "slate" | "sky" | "green"> = {
  pending: "slate",
  submitted: "sky",
  graded: "green",
};

/**
 * Staff view of every submission on one assignment: student answers, attached
 * files, and an inline grading form (score + feedback). This is where teachers
 * inspect and, if the AI mis-graded, override a student's mark.
 */
export function SubmissionInspector({ assignmentId }: { assignmentId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["assignment-submissions", assignmentId],
    queryFn: () => listSubmissionsForAssignment(assignmentId),
  });
  const [search, setSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const sections = useMemo(() => {
    const set = new Set((data ?? []).map((s) => s.section).filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((s) => {
      if (sectionFilter !== "all" && s.section !== sectionFilter) return false;
      if (!q) return true;
      return (
        s.full_name.toLowerCase().includes(q) ||
        (s.student_no ?? "").toLowerCase().includes(q) ||
        (s.section ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search, sectionFilter]);

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["assignment-submissions", assignmentId] });

  if (isLoading)
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading submissions…</p>;
  if (!data || data.length === 0) {
    return <EmptyState title="No submissions yet" sub="No student has submitted this activity." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, student no.…"
            aria-label="Search students"
            className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {sections.length > 1 && (
          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger className="h-10 w-[140px] rounded-xl" aria-label="Filter by section">
              <SelectValue placeholder="All sections" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sections</SelectItem>
              {sections.map((sec) => (
                <SelectItem key={sec} value={sec}>
                  {sec}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} of {data.length} student{data.length !== 1 ? "s" : ""}
      </p>

      {filtered.length === 0 ? (
        <EmptyState title="No matches" sub="Try a different search or filter." />
      ) : (
        filtered.map((s) => (
          <div key={s.id} className="rounded-xl border border-border/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <UserAvatar src={null} name={s.full_name} />
                <div>
                  <p className="text-sm font-semibold">{s.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.student_no ?? "—"}
                    {s.section ? ` · ${s.section}` : ""}
                    {s.submitted_at ? ` · submitted ${fmtDate(s.submitted_at)}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {s.score != null && (
                  <Badge tone="green">
                    {s.score}
                    {s.status === "graded" ? " · graded" : ""}
                  </Badge>
                )}
                <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                <button
                  onClick={() => setOpenId(openId === s.id ? null : s.id)}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15"
                >
                  {openId === s.id ? "Close" : "Inspect"}
                </button>
              </div>
            </div>

            {openId === s.id && <SubmissionDetail submission={s} onGraded={refresh} />}
          </div>
        ))
      )}
    </div>
  );
}

function SubmissionDetail({
  submission,
  onGraded,
}: {
  submission: AssignmentSubmission;
  onGraded: () => void;
}) {
  const [score, setScore] = useState(submission.score?.toString() ?? "");
  const [feedback, setFeedback] = useState(submission.feedback ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    // Validate before entering the saving state.
    const parsed = score.trim() === "" ? null : Number(score);
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
      toast.error("Score must be a non-negative number.");
      return;
    }
    setSaving(true);
    try {
      await gradeSubmission(submission.id, {
        score: parsed,
        feedback: feedback.trim() || null,
        // Only assert "graded" when a score is present; clearing the score
        // leaves the server-side status untouched (never downgrades).
        ...(parsed != null ? { status: "graded" as const } : {}),
      });
      toast.success("Grade saved.");
      onGraded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the grade.");
    } finally {
      setSaving(false);
    }
  };

  const files = submission.file_urls ?? [];

  return (
    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
      {/* Student's written answer */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Student answer
        </p>
        {submission.content ? (
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">
            {submission.content}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No written answer.</p>
        )}
      </div>

      {/* Attached files */}
      {files.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" /> Submitted files
          </p>
          <ul className="mt-1 grid gap-1.5">
            {files.map((a) => (
              <li
                key={a.path ?? a.url}
                className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5"
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
      )}

      {/* Teacher grading form */}
      <div className="rounded-xl bg-muted/40 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Teacher grading
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={score}
            onChange={(e) => setScore(sanitizeDecimal(e.target.value))}
            inputMode="decimal"
            placeholder="Score"
            aria-label={`Score for ${submission.full_name}`}
            className="h-10 w-24 rounded-lg border border-input bg-background px-3 text-center text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Feedback (optional)"
            aria-label={`Feedback for ${submission.full_name}`}
            className="h-10 min-w-48 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={save}
            disabled={saving}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save grade"}
          </button>
        </div>
      </div>
    </div>
  );
}
