import type { AttendanceStatus } from "@/lib/lms";

export const COURSE_STYLE: Record<string, { chip: string; soft: string; bar: string }> = {
  indigo: {
    chip: "bg-indigo-600",
    soft: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
    bar: "bg-indigo-500",
  },
  emerald: {
    chip: "bg-emerald-600",
    soft: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  sky: {
    chip: "bg-sky-600",
    soft: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    bar: "bg-sky-500",
  },
  amber: {
    chip: "bg-pink-500",
    soft: "bg-pink-50 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300",
    bar: "bg-pink-500",
  },
  rose: {
    chip: "bg-rose-600",
    soft: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    bar: "bg-rose-500",
  },
  violet: {
    chip: "bg-violet-600",
    soft: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    bar: "bg-violet-500",
  },
};

const FALLBACK_STYLE = COURSE_STYLE["indigo"]!;

export function courseStyle(color: string) {
  return COURSE_STYLE[color] ?? FALLBACK_STYLE;
}

export function attendanceTone(status: AttendanceStatus): { tone: string; label: string } {
  if (status === "late") return { tone: "amber", label: "Late" };
  if (status === "excused") return { tone: "violet", label: "Excused" };
  return { tone: "green", label: "On time" };
}
