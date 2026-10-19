import { Pencil, Trash2 } from "lucide-react";
import { type Course, type Profile, formatSchedule } from "@/lib/lms";
import { MotionCard, Badge, courseStyle } from "@/components/lms";
import { courseLevelLabel } from "@/lib/course-levels";
import { EnrollmentCount } from "@/components/courses/enrollment-count";
import { cn } from "@/lib/utils";

interface CourseCardGridProps {
  courses: Course[];
  profile: Profile;
  isAdmin: boolean;
  onOpen?: (course: Course) => void;
  onEdit: (course: Course) => void;
  onRemove: (course: Course) => void;
}

export function CourseCardGrid({
  courses,
  profile,
  isAdmin,
  onOpen,
  onEdit,
  onRemove,
}: CourseCardGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((c, i) => {
        const st = courseStyle(c.color);
        return (
          <MotionCard key={c.id} delay={Math.min(i * 0.05, 0.3)} className="overflow-hidden">
            <div className={cn("h-2", st.chip)} />
            <div className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-muted-foreground">{c.code}</p>
                <div className="flex items-center gap-1">
                  <Badge tone="slate">{courseLevelLabel(c)}</Badge>
                  {(isAdmin || c.teacher_id === profile.id) && (
                    <button
                      onClick={() => onEdit(c)}
                      title="Edit course"
                      aria-label={`Edit course ${c.code} — ${c.title}`}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => onRemove(c)}
                      title="Delete course"
                      aria-label={`Delete course ${c.code} — ${c.title}`}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpen?.(c)}
                aria-label={`Open course ${c.code} — ${c.title}`}
                className="mt-1.5 flex w-full items-center gap-2 text-left font-semibold leading-snug hover:text-primary"
              >
                <span>{c.title}</span>
              </button>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.teacher_name ?? "No teacher assigned"}
              </p>
              {formatSchedule(c) && (
                <p className="mt-1 text-xs font-medium text-primary">{formatSchedule(c)}</p>
              )}
              <EnrollmentCount courseId={c.id} />
              <button
                type="button"
                onClick={() => onOpen?.(c)}
                aria-label={`Open course ${c.code} — ${c.title}`}
                className="mt-3 flex h-9 w-full items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary hover:bg-primary/15"
              >
                Open course →
              </button>
            </div>
          </MotionCard>
        );
      })}
    </div>
  );
}
