/**
 * Shared assessment-integrity types + helpers (pure, no React).
 *
 * Kept separate from the `useAntiCheat` hook so server modules and the RPC layer
 * can reference the event union without pulling in React.
 */

export type IntegrityEventType =
  "blur" | "visibilitychange" | "fullscreenchange" | "devtools" | "paste" | "contextmenu";

export interface IntegrityEvent {
  /** Date.now() timestamp */
  at: number;
  /** Which signal triggered this */
  type: IntegrityEventType;
}

/** Backwards-compatible alias — the server field is still named `tab_switches`. */
export type TabSwitch = IntegrityEvent;

export const INTEGRITY_EVENT_TYPES: readonly IntegrityEventType[] = [
  "blur",
  "visibilitychange",
  "fullscreenchange",
  "devtools",
  "paste",
  "contextmenu",
] as const;

/** Human-readable label for a recorded event. */
export function integrityLabel(type: IntegrityEventType): string {
  switch (type) {
    case "blur":
      return "Window lost focus";
    case "visibilitychange":
      return "Tab switch";
    case "fullscreenchange":
      return "Left full-screen";
    case "devtools":
      return "Developer tools detected";
    case "paste":
      return "Paste detected";
    case "contextmenu":
      return "Context menu opened";
  }
}

/** True for the signals a teacher would consider a serious integrity risk. */
export function isSevereIntegrityEvent(type: IntegrityEventType): boolean {
  return type === "devtools" || type === "fullscreenchange" || type === "paste";
}

/**
 * Get severity color for an integrity-event count.
 * Returns a Tailwind-compatible class string.
 */
export function switchSeverity(count: number): {
  bg: string;
  text: string;
  label: string;
} {
  if (count === 0)
    return {
      bg: "bg-emerald-500/15",
      text: "text-emerald-600 dark:text-emerald-400",
      label: "No switches",
    };
  if (count <= 2)
    return {
      bg: "bg-amber-500/15",
      text: "text-amber-600 dark:text-amber-400",
      label: `${count} switch${count > 1 ? "es" : ""}`,
    };
  return {
    bg: "bg-rose-500/15",
    text: "text-rose-600 dark:text-rose-400",
    label: `${count} switches`,
  };
}
