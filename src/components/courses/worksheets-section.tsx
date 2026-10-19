import React from "react";
import { Settings2, Users, Pencil, Trash2 } from "lucide-react";
import { type Course, type Quiz } from "@/lib/lms";
import { MotionCard, courseStyle } from "@/components/lms";
import { POLICY_LABELS } from "@/components/courses/constants";
import { MaterialManager } from "@/components/courses/material-manager";
import { RowActionsMenu } from "@/components/courses/row-actions";
import { cn } from "@/lib/utils";

interface WorksheetsSectionProps {
  quizzes: Quiz[];
  courses: Course[];
  onPolicy: (quiz: Quiz) => void;
  onEdit: (quiz: Quiz) => void;
  onRemove: (quiz: Quiz) => void;
  onRoster: (quiz: Quiz) => void;
}

export const WorksheetsSection = React.memo(function WorksheetsSection({
  quizzes,
  courses,
  onPolicy,
  onEdit,
  onRemove,
  onRoster,
}: WorksheetsSectionProps) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-bold">Worksheets</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Configure retake policies and review per-student attempts.
      </p>
      <div className="mt-3 grid gap-2">
        {quizzes.map((q) => {
          const course = courses.find((c) => c.id === q.course_id);
          const st = courseStyle(course?.color ?? "indigo");
          return (
            <MotionCard key={q.id} className="flex flex-wrap items-center gap-3 p-4">
              <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold", st.soft)}>
                {course?.code ?? "—"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{q.title}</p>
                <p className="text-xs text-muted-foreground">
                  {q.allow_retake
                    ? q.max_attempts === 0
                      ? "Retakes allowed · unlimited attempts"
                      : `Retakes allowed · up to ${q.max_attempts} attempt${q.max_attempts === 1 ? "" : "s"}`
                    : "Single attempt"}
                  {" · "}
                  {POLICY_LABELS[q.retake_score_policy]}
                </p>
              </div>
              <button
                onClick={() => onRoster(q)}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15"
              >
                <Users className="h-3.5 w-3.5" /> Attempts
              </button>
              <RowActionsMenu
                label={`Actions for worksheet ${q.title}`}
                actions={[
                  {
                    label: "Retake policy",
                    icon: <Settings2 className="h-3.5 w-3.5" />,
                    onSelect: () => onPolicy(q),
                  },
                  {
                    label: "Edit",
                    icon: <Pencil className="h-3.5 w-3.5" />,
                    onSelect: () => onEdit(q),
                    ariaLabel: `Edit worksheet ${q.title}`,
                  },
                  {
                    label: "Delete",
                    icon: <Trash2 className="h-3.5 w-3.5" />,
                    onSelect: () => onRemove(q),
                    destructive: true,
                    ariaLabel: `Remove worksheet ${q.title}`,
                  },
                ]}
              />
              <div className="w-full">
                <MaterialManager
                  target="quiz"
                  id={q.id}
                  courseId={q.course_id}
                  attachments={q.attachments ?? []}
                />
              </div>
            </MotionCard>
          );
        })}
      </div>
    </section>
  );
});
