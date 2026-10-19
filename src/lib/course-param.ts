/**
 * Extract the selected course id from a URL query string.
 * Returns null when the param is missing or blank, so callers can safely fall
 * back to the course grid instead of showing an empty workspace.
 */
export function readCourseParam(search: string): string | null {
  if (!search) return null;
  const value = new URLSearchParams(search).get("course");
  return value && value.trim() ? value : null;
}
