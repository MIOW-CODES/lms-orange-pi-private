/*
 * Shared lockdown UI + the app-wide student lockdown activation.
 *
 * `LockdownOverlay` is the exact fullscreen-loss overlay the exam flow uses
 * (copy differs per context); `LockdownProvider` holds the single `useExamLock`
 * activation that exam-time and app-wide kiosk lockdown share; `KioskLockdown`
 * registers the app-wide demand for student sessions when the admin kiosk
 * setting is on and shows the kiosk copy of the overlay outside exams.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useProfile } from "@/hooks";
import { useExamLock } from "@/hooks/useExamLock";
import {
  LockdownContext,
  useLockdown,
  useLockdownDemand,
  useLockdownMode,
} from "@/hooks/useLockdown";
import { shouldKioskLockdown } from "@/lib/lockdown";
import { getKioskLockdown } from "@/lib/lms";

export interface LockdownCopy {
  title: string;
  body: string;
}

export const EXAM_LOCKDOWN_COPY: LockdownCopy = {
  title: "Exam lockdown active",
  body: "This exam runs in fullscreen. Return to fullscreen to keep answering — your timer is still running.",
};

export const KIOSK_LOCKDOWN_COPY: LockdownCopy = {
  title: "Kiosk mode active",
  body: "Kiosk lockdown is on for this device. Return to fullscreen to keep using the app — sign out from the sidebar when you are done.",
};

/** Fullscreen-loss overlay — shared by exam-time and app-wide kiosk lockdown. */
export function LockdownOverlay({ copy, onReturn }: { copy: LockdownCopy; onReturn: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background/95 p-8 text-center backdrop-blur">
      <ShieldCheck className="h-10 w-10 text-primary" />
      <p className="text-lg font-semibold">{copy.title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{copy.body}</p>
      <button
        onClick={onReturn}
        className="flex h-11 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Return to fullscreen
      </button>
    </div>
  );
}

/**
 * Single activation of the hard lockdown for the whole app. Demands come from
 * `useLockdownDemand` ("exam" / "kiosk"); exam copy wins while an attempt runs,
 * so the two flows never stack overlays or double-install input blocking.
 */
export function LockdownProvider({ children }: { children: ReactNode }) {
  const mode = useLockdownMode();
  const lock = useExamLock(mode !== null);
  return <LockdownContext.Provider value={lock}>{children}</LockdownContext.Provider>;
}

/**
 * App-wide kiosk lockdown for student sessions (admin-toggled). Registers the
 * "kiosk" demand and shows the return-to-fullscreen overlay outside exams —
 * during a worksheet attempt the exam overlay (in the quizzes route) takes over.
 */
export function KioskLockdown() {
  const profile = useProfile();
  // Poll so an admin toggle reaches open kiosk sessions without a reload.
  const { data: enabled } = useQuery({
    queryKey: ["kiosk-lockdown"],
    queryFn: getKioskLockdown,
    enabled: profile?.role === "student",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const active = shouldKioskLockdown(profile?.role, enabled === true);
  useLockdownDemand("kiosk", active);
  const mode = useLockdownMode();
  const lockdown = useLockdown();

  if (!active || mode !== "kiosk" || !lockdown.lockLost) return null;
  return <LockdownOverlay copy={KIOSK_LOCKDOWN_COPY} onReturn={lockdown.lock} />;
}
