/*
 * Exam hard-lock for the installed PWA / browser during an active attempt.
 *
 * Strengthens `useAntiCheat` (which only records events) into an actual lock:
 * - Requests Fullscreen when the exam starts and when the student clicks
 *   "Return to fullscreen". If fullscreen was entered and then lost (Esc), a
 *   full-screen overlay blocks the exam until it is restored.
 * - Blocks copy / cut / paste / drag / right-click / text selection (outside
 *   inputs) and common escape h shortcuts (devtools, print, save, view-source).
 * - Holds a screen wake lock so the device doesn't sleep mid-exam.
 * - Warns before unloading/refreshing while an attempt is in progress.
 *
 * Deliberate softness: on browsers without the Fullscreen API (iPhone Safari),
 * fullscreen is never requested and the overlay never appears — input blocking
 * still applies. Nothing here ever traps a student with no way forward; the
 * overlay's button always re-enters fullscreen from a user gesture.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type WakeLockSentinelLike = { release?: () => Promise<void> | void };
type WakeLockLike = { request: (type: "screen") => Promise<WakeLockSentinelLike> };

export interface ExamLockState {
  /** Document fullscreen is available in this browser. */
  supported: boolean;
  /** Fullscreen was entered during this attempt and has since been lost. */
  lockLost: boolean;
  /** Enter fullscreen now — call from a user gesture when possible. */
  lock: () => void;
}

export function useExamLock(active: boolean): ExamLockState {
  const [supported, setSupported] = useState(false);
  const [lockLost, setLockLost] = useState(false);
  // True once fullscreen has actually been entered this attempt — gates the
  // overlay so we never trap students on browsers that refuse fullscreen.
  const enteredRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    setSupported(typeof document !== "undefined" && !!document.documentElement.requestFullscreen);
  }, []);

  const lock = useCallback(() => {
    const el = document.documentElement;
    if (!el.requestFullscreen || document.fullscreenElement) return;
    // Rejection (no transient gesture, policy) is fine — input lock still applies.
    void el.requestFullscreen().catch(() => {});
  }, []);

  // Best-effort fullscreen at attempt start: the click that began the attempt
  // is usually still inside the browser's transient-activation window.
  useEffect(() => {
    if (!active) {
      enteredRef.current = false;
      setLockLost(false);
      return;
    }
    lock();
  }, [active, lock]);

  // Track fullscreen entry/exit: leaving fullscreen mid-exam raises the overlay.
  useEffect(() => {
    if (!active) return;
    const onChange = () => {
      if (document.fullscreenElement) {
        enteredRef.current = true;
        setLockLost(false);
      } else if (enteredRef.current) {
        setLockLost(true);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [active]);

  // Input lockdown while assessing.
  useEffect(() => {
    if (!active) return;
    const prevent = (e: Event) => e.preventDefault();
    // Allow selection inside editable fields so students can still fix typos.
    const onSelectStart = (e: Event) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const blocked =
        key === "f12" ||
        (mod && ["c", "x", "v", "p", "s", "u", "n", "w", "j", "i"].includes(key)) ||
        (mod && e.shiftKey && ["i", "j", "c"].includes(key)) ||
        key === "printscreen";
      if (blocked) {
        e.preventDefault();
        // PrintScreen still captures on some platforms — poison the clipboard
        // as a deterrent (best-effort; clipboard write may be denied).
        if (key === "printscreen") void navigator.clipboard?.writeText("").catch(() => {});
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    // Paste is allowed in textareas so students can paste code into
    // free-text / code answers; it stays blocked everywhere else.
    const onPaste = (e: Event) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      e.preventDefault();
    };

    document.addEventListener("contextmenu", prevent);
    document.addEventListener("copy", prevent);
    document.addEventListener("cut", prevent);
    document.addEventListener("paste", onPaste);
    document.addEventListener("selectstart", onSelectStart);
    document.addEventListener("dragstart", prevent);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("contextmenu", prevent);
      document.removeEventListener("copy", prevent);
      document.removeEventListener("cut", prevent);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("selectstart", onSelectStart);
      document.removeEventListener("dragstart", prevent);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active]);

  // Keep the screen awake during the exam; re-acquire after tab switches.
  useEffect(() => {
    if (!active || typeof navigator === "undefined") return;
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!wakeLock) return;
    let cancelled = false;
    const acquire = () => {
      wakeLock
        .request("screen")
        .then((sentinel) => {
          if (cancelled) {
            void sentinel.release?.();
            return;
          }
          wakeLockRef.current = sentinel;
        })
        .catch(() => {});
    };
    acquire();
    const onVisible = () => {
      if (!cancelled && document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      try {
        void wakeLockRef.current?.release?.();
      } catch {
        /* release is best-effort */
      }
      wakeLockRef.current = null;
    };
  }, [active]);

  return { supported, lockLost, lock };
}
