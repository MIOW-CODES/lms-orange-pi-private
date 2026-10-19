/**
 * Lockdown composition (pure, no React).
 *
 * App-wide kiosk lockdown (admin setting) and exam-time lockdown (worksheet
 * attempt) share ONE activation of `useExamLock`, so the fullscreen overlay,
 * input blocking and wake lock never double-fire. Routes register demands here
 * ("exam" while an attempt runs, "kiosk" while app-wide lockdown applies); the
 * shared activation lives in `LockdownProvider` (src/components/lockdown.tsx).
 * When both demands are active at once (kiosk device mid-exam), exam copy wins.
 */

export type LockdownDemand = "exam" | "kiosk";
export type LockdownMode = "exam" | "kiosk" | null;

/**
 * Role + setting gating for app-wide kiosk lockdown: only student sessions are
 * ever locked down — teachers, admins and signed-out visitors are unaffected.
 */
export function shouldKioskLockdown(
  role: string | null | undefined,
  kioskLockdownEnabled: boolean,
): boolean {
  return role === "student" && kioskLockdownEnabled === true;
}

let examActive = false;
let kioskActive = false;
const listeners = new Set<() => void>();

/** Register (or clear) a lockdown demand. */
export function setLockdownDemand(demand: LockdownDemand, active: boolean): void {
  const current = demand === "exam" ? examActive : kioskActive;
  if (current === active) return;
  if (demand === "exam") {
    examActive = active;
  } else {
    kioskActive = active;
  }
  for (const listener of [...listeners]) listener();
}

/** Composed mode — exam copy takes priority while an attempt is active. */
export function getLockdownMode(): LockdownMode {
  if (examActive) return "exam";
  if (kioskActive) return "kiosk";
  return null;
}

/** Subscribe to demand changes (for useSyncExternalStore). */
export function subscribeLockdown(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook: drop all demands and subscribers. */
export function resetLockdown(): void {
  examActive = false;
  kioskActive = false;
  listeners.clear();
}
