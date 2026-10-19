import { createFileRoute } from "@tanstack/react-router";
import { TosPage } from "@/components/courses/tos-view";

export const Route = createFileRoute("/dashboard/teacher/tos")({
  head: () => ({
    meta: [
      { title: "Table of Specifications | MIOW - Integrated Developmental School" },
      { name: "description", content: "Build each term's Table of Specifications." },
    ],
  }),
  component: TosPage,
});
