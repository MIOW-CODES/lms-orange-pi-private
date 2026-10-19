import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ORDINAL_SUFFIX = ["th", "st", "nd", "rd"] as const;
function ordinal(n: number): string {
  // Standard English ordinal rules: 11/12/13 take "th" regardless of last digit
  // (handled by the `v - 20` wrap), otherwise the last digit selects the suffix.
  const v = n % 100;
  return `${n}${ORDINAL_SUFFIX[(v - 20) % 10] ?? ORDINAL_SUFFIX[v] ?? ORDINAL_SUFFIX[0]}`;
}

/**
 * Human-readable grade level label.
 * 7–10 → "Grade 7" .. "Grade 10" (JHS)
 * 11–12 → "Grade 11" .. "Grade 12" (SHS)
 * 13–16 → "1st Year" .. "4th Year" (College)
 */
export function gradeLevelLabel(level: number | null | undefined, short = false): string {
  if (level == null) return "—";
  if (level <= 12) return short ? `G${level}` : `Grade ${level}`;
  const yr = level - 12;
  return short ? `${ordinal(yr)} Yr` : `${ordinal(yr)} Year`;
}

/**
 * Sanitize free-typed decimal input: keep digits and at most one decimal point.
 * Prevents inputs like "1.2.3" from reaching validation as NaN.
 */
export function sanitizeDecimal(input: string): string {
  const cleaned = input.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}
