import { createFileRoute } from "@tanstack/react-router";
import { ReportFeedbackPage } from "@/components/report-feedback-page";
import { STUDENT_NAV } from "@/components/lms";

export const Route = createFileRoute("/dashboard/student/report")({
  head: () => ({ meta: [{ title: "Report an Issue | MIOW" }] }),
  component: () => (
    <ReportFeedbackPage roles={["student"]} nav={STUDENT_NAV} subtitle="Student Portal" />
  ),
});
