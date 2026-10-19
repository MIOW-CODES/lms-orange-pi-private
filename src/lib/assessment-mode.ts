/*
 * Assessment integrity mode — a tiny global store that student pages flip on
 * while a Worksheet, Assignment, or Exam is actively being taken. Peer-help
 * surfaces (the ClassMate Assistant chat widget) subscribe and hide themselves
 * for the duration of the assessment.
 *
 * Also tracks tab-switch events for anti-cheat logging.
 */
import { useSyncExternalStore } from "react";
import type { TabSwitch } from "@/lib/anti-cheat";

let active = false;
const listeners = new Set<() => void>();

/** Enter/exit assessment mode. Safe to call repeatedly with the same value. */
export function setAssessmentMode(next: boolean) {
  if (active === next) return;
  active = next;
  listeners.forEach((l) => l());
}

export function subscribeAssessmentMode(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while the student is actively taking an assessment. */
export function useAssessmentMode(): boolean {
  return useSyncExternalStore(
    subscribeAssessmentMode,
    () => active,
    () => false, // server snapshot: never in assessment mode during SSR
  );
}

// ── Tab-switch accumulator ──────────────────────────────────────────
// Stores tab switches for the current assessment attempt.
// Flushed on submit and reset when assessment ends.

let tabSwitches: TabSwitch[] = [];

export function recordTabSwitch(entry: TabSwitch) {
  tabSwitches.push(entry);
}

export function getTabSwitches(): TabSwitch[] {
  return tabSwitches;
}

export function resetTabSwitches() {
  tabSwitches = [];
}

export function isAssessmentActive() {
  return active;
}
