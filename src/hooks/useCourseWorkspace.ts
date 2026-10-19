import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Profile, enrollmentsForCourse, listStudents } from "@/lib/lms";
import { readCourseParam } from "@/lib/course-param";

/**
 * Read/sync the selected course from the `?course=<id>` query parameter so the
 * course workspace is deep-linkable and the browser back/forward buttons work.
 * Kept route-agnostic (plain History API) because the same page is mounted under
 * both the admin and teacher route trees.
 *
 * An unknown/invalid id resolves to `null` in the caller (no course matches), so
 * the page gracefully falls back to the course grid.
 */
export function useCourseSelection(): [string | null, (id: string | null) => void] {
  const read = () =>
    typeof window === "undefined" ? null : readCourseParam(window.location.search);

  // Start null so SSR and the first client render match (avoids a hydration
  // mismatch), then adopt the URL param once mounted.
  const [courseId, setCourseId] = useState<string | null>(null);

  useEffect(() => {
    setCourseId(read());
    const onPop = () => setCourseId(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const select = (next: string | null) => {
    setCourseId(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("course", next);
    else url.searchParams.delete("course");
    window.history.pushState({}, "", url);
  };

  return [courseId, select];
}

/** Resolve the enrolled students for a course (used by roster + class record). */
export function useCourseRoster(courseId: string | null | undefined): {
  roster: Profile[];
  loading: boolean;
} {
  const { data: enrolledIds, isPending: enrollmentsPending } = useQuery({
    queryKey: ["enrollments", courseId],
    queryFn: () => enrollmentsForCourse(courseId as string),
    enabled: !!courseId,
  });
  const { data: students, isPending: studentsPending } = useQuery({
    queryKey: ["students"],
    queryFn: listStudents,
    enabled: !!courseId,
  });

  const roster = useMemo(() => {
    const ids = new Set(enrolledIds ?? []);
    return (students ?? []).filter((s) => ids.has(s.id));
  }, [students, enrolledIds]);

  return {
    roster,
    loading: !!courseId && (enrollmentsPending || studentsPending),
  };
}
