import { createFileRoute } from "@tanstack/react-router";
import { QuestionBankPage } from "@/components/courses/question-bank";

export const Route = createFileRoute("/dashboard/teacher/question-bank")({
  head: () => ({
    meta: [
      { title: "Question Bank | MIOW - Integrated Developmental School" },
      { name: "description", content: "Browse and edit worksheet questions across courses." },
    ],
  }),
  component: QuestionBankPage,
});
