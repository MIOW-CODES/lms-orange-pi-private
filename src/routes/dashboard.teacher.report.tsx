import { createFileRoute } from "@tanstack/react-router";
import { ReportFeedbackPage } from "@/components/report-feedback-page";
import { TEACHER_NAV } from "@/components/lms";

export const Route = createFileRoute("/dashboard/teacher/report")({
  head: () => ({ meta: [{ title: "Report an Issue | MIOW" }] }),
  component: () => (
    <ReportFeedbackPage roles={["teacher"]} nav={TEACHER_NAV} subtitle="Teacher Portal" />
  ),
});
