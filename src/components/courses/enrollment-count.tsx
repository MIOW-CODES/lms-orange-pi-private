import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { enrollmentsForCourse } from "@/lib/lms";

export function EnrollmentCount({ courseId }: { courseId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["enrollments", courseId],
    queryFn: () => enrollmentsForCourse(courseId),
  });

  if (isLoading || data === undefined) {
    return (
      <div className="mt-3 flex items-center gap-1.5">
        <span className="h-3.5 w-24 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Plus className="hidden" />
      {data.length} students enrolled
    </p>
  );
}
