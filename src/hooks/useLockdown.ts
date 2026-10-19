/*
 * React glue for the shared lockdown activation (logic in src/lib/lockdown.ts).
 *
 * `LockdownProvider` (src/components/lockdown.tsx) mounts the ONE `useExamLock`
 * instance for the whole app; routes register demands ("exam" while a worksheet
 * attempt runs, "kiosk" while app-wide kiosk lockdown applies) and read the
 * shared lock state here — so app-wide and exam-time lockdown compose through a
 * single activation and never double-fire.
 */
import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import type { ExamLockState } from "@/hooks/useExamLock";
import {
  getLockdownMode,
  setLockdownDemand,
  subscribeLockdown,
  type LockdownDemand,
  type LockdownMode,
} from "@/lib/lockdown";

/** Used when no LockdownProvider is mounted — inert, never blocks anything. */
const INERT_LOCK: ExamLockState = {
  supported: false,
  lockLost: false,
  lock: () => {},
};

export const LockdownContext = createContext<ExamLockState>(INERT_LOCK);

/** Register a lockdown demand for as long as `active` is true. */
export function useLockdownDemand(demand: LockdownDemand, active: boolean): void {
  useEffect(() => {
    setLockdownDemand(demand, active);
    return () => setLockdownDemand(demand, false);
  }, [demand, active]);
}

/** Composed lockdown mode: "exam" | "kiosk" | null. */
export function useLockdownMode(): LockdownMode {
  return useSyncExternalStore(subscribeLockdown, getLockdownMode, () => null);
}

/** Shared lock state — overlay flag + "return to fullscreen" gesture entry. */
export function useLockdown(): ExamLockState {
  return useContext(LockdownContext);
}
