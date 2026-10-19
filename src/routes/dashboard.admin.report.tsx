import { createFileRoute } from "@tanstack/react-router";
import { ReportFeedbackPage } from "@/components/report-feedback-page";
import { ADMIN_NAV } from "@/components/lms";

export const Route = createFileRoute("/dashboard/admin/report")({
  head: () => ({ meta: [{ title: "Report Inbox | MIOW" }] }),
  component: () => (
    <ReportFeedbackPage roles={["admin"]} nav={ADMIN_NAV} subtitle="Admin Console" />
  ),
});
