import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, MessageSquare, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  createFeedbackReport,
  listFeedbackReports,
  updateFeedbackReport,
  type FeedbackReport,
  type Profile,
  type Role,
} from "@/lib/lms";
import {
  AppShell,
  Badge,
  Card,
  EmptyState,
  staffNav,
  type NavItem,
  useProfile,
} from "@/components/lms";
import { LoadingSkeleton } from "@/components/ui-elements";

const CATEGORIES: Array<{ value: FeedbackReport["category"]; label: string }> = [
  { value: "bug", label: "Bug or broken feature" },
  { value: "issue", label: "Issue with my account or access" },
  { value: "feedback", label: "Suggestion or feedback" },
  { value: "course_content", label: "Course or content correction" },
  { value: "other", label: "Other" },
];

const STATUS_LABELS: Record<FeedbackReport["status"], string> = {
  open: "Open",
  in_review: "In review",
  resolved: "Resolved",
  closed: "Closed",
};

const STATUS_TONES: Record<FeedbackReport["status"], string> = {
  open: "amber",
  in_review: "sky",
  resolved: "green",
  closed: "slate",
};

function formatReportDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function reportLabel(category: FeedbackReport["category"]) {
  return CATEGORIES.find((item) => item.value === category)?.label ?? "Report";
}

export function ReportFeedbackPage({
  roles,
  nav,
  subtitle,
}: {
  roles: Role[];
  nav: NavItem[];
  subtitle: string;
}) {
  const profile = useProfile(roles);
  const qc = useQueryClient();
  const [category, setCategory] = useState<FeedbackReport["category"]>("bug");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [sent, setSent] = useState(false);
  const { data: reports, isLoading } = useQuery({
    queryKey: ["feedback-reports", profile?.id, profile?.role],
    queryFn: listFeedbackReports,
    enabled: !!profile,
  });
  const createMutation = useMutation({
    mutationFn: () =>
      createFeedbackReport({
        category,
        subject: subject.trim(),
        description: description.trim(),
        page_url: typeof window === "undefined" ? null : window.location.href,
      }),
    onSuccess: () => {
      setSubject("");
      setDescription("");
      setSent(true);
      void qc.invalidateQueries({ queryKey: ["feedback-reports", profile?.id, profile?.role] });
      toast.success("Report received. Thank you for helping improve MIOW.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not send report."),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: FeedbackReport["status"] }) =>
      updateFeedbackReport(id, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["feedback-reports"] });
      toast.success("Report status updated.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not update report."),
  });

  if (!profile) return null;
  if (isLoading) {
    return (
      <AppShell nav={nav} profile={profile} subtitle={subtitle}>
        <LoadingSkeleton />
      </AppShell>
    );
  }

  const isAdmin = profile.role === "admin";
  const canSubmit = subject.trim().length > 0 && description.trim().length > 0;
  return (
    <AppShell nav={nav} profile={profile} subtitle={subtitle}>
      <div className="mb-8 max-w-3xl">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <Flag className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">Report an issue</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tell the MIOW team about a bug, access problem, course correction, or idea. Include
              enough detail for someone to reproduce it.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
        <Card className="p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" aria-hidden />
            <h2 className="text-lg font-semibold">Send a report</h2>
          </div>
          {sent && (
            <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
              Your report is in the queue. You can send another report below if needed.
            </div>
          )}
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit && !createMutation.isPending) createMutation.mutate();
            }}
          >
            <label className="block text-sm font-semibold" htmlFor="report-category">
              What are you reporting?
              <select
                id="report-category"
                value={category}
                onChange={(event) => setCategory(event.target.value as FeedbackReport["category"])}
                className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                {CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold" htmlFor="report-subject">
              Short title
              <input
                id="report-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={200}
                placeholder="Example: Arduino Lab fullscreen button does not open"
                className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
                required
              />
            </label>
            <label className="block text-sm font-semibold" htmlFor="report-description">
              What happened?
              <textarea
                id="report-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={10000}
                rows={7}
                placeholder="Describe what you expected, what happened instead, and the steps that led there."
                className="mt-1.5 w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-normal outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
                required
              />
              <span className="mt-1 block text-right text-xs font-normal text-muted-foreground">
                {description.length}/10,000
              </span>
            </label>
            <button
              type="submit"
              disabled={!canSubmit || createMutation.isPending}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden />
              {createMutation.isPending ? "Sending…" : "Send report"}
            </button>
          </form>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-2">
            {isAdmin ? (
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
            ) : (
              <MessageSquare className="h-5 w-5 text-primary" aria-hidden />
            )}
            <h2 className="text-lg font-semibold">{isAdmin ? "Report inbox" : "My reports"}</h2>
          </div>
          {!reports?.length ? (
            <EmptyState
              title={isAdmin ? "No reports yet" : "Nothing reported yet"}
              sub={
                isAdmin
                  ? "New reports from users will appear here."
                  : "Your submitted reports will appear here with their status."
              }
            />
          ) : (
            <div className="space-y-3">
              {reports.map((report) => (
                <article
                  key={report.id}
                  className="rounded-xl border border-border/70 bg-background/60 p-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {reportLabel(report.category)}
                      </p>
                      <h3 className="mt-1 font-semibold text-foreground">{report.subject}</h3>
                    </div>
                    <Badge tone={STATUS_TONES[report.status]}>{STATUS_LABELS[report.status]}</Badge>
                  </div>
                  {isAdmin && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {report.reporter_name ?? "Unknown user"} · {report.reporter_role ?? "user"}
                      {report.reporter_email ? ` · ${report.reporter_email}` : ""}
                    </p>
                  )}
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {report.description}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{formatReportDate(report.created_at)}</span>
                    {isAdmin && (
                      <select
                        aria-label={`Status for ${report.subject}`}
                        value={report.status}
                        disabled={updateMutation.isPending}
                        onChange={(event) =>
                          updateMutation.mutate({
                            id: report.id,
                            status: event.target.value as FeedbackReport["status"],
                          })
                        }
                        className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-semibold text-foreground"
                      >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {report.admin_note && (
                    <p className="mt-3 rounded-lg bg-muted/70 p-2.5 text-xs text-muted-foreground">
                      Admin note: {report.admin_note}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
