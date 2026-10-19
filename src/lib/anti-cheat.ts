/*
 * Anti-cheat / assessment integrity for timed worksheets, assignments, and exams.
 *
 * Detects and timestamps integrity events during an active assessment:
 * - `blur`              window loses focus
 * - `visibilitychange`  tab/window hidden
 * - `fullscreenchange`  leaving full-screen
 * - `devtools`          devtools shortcuts or a suspicious window-size delta
 * - `paste`             pasting into the assessment
 * - `contextmenu`       right-click / long-press menu
 *
 * Design decisions:
 * - Uses both `blur` and `visibilitychange` for maximum coverage
 * - Stores timestamps in a ref (not state) to avoid re-renders; only aggregate
 *   counts + the last event live in state so the banner can react
 * - Records every event and lets the caller decide how to respond to the first one
 * - `clear()` lets a caller reset between attempts
 *
 * The event union + display helpers live in `@/lib/integrity` so server modules
 * can share them without importing React.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { type IntegrityEvent, type IntegrityEventType, type TabSwitch } from "@/lib/integrity";

export type { IntegrityEvent, IntegrityEventType, TabSwitch };
export {
  INTEGRITY_EVENT_TYPES,
  integrityLabel,
  isSevereIntegrityEvent,
  switchSeverity,
} from "@/lib/integrity";

export interface AntiCheatState {
  /** All recorded integrity events */
  events: IntegrityEvent[];
  /** Backwards-compatible alias for `events` */
  tabSwitches: IntegrityEvent[];
  /** events.length */
  count: number;
  /** Backwards-compatible alias for `count` */
  switchCount: number;
  /** Per-type totals */
  counts: Record<IntegrityEventType, number>;
  /** Most recent event type, or null */
  lastType: IntegrityEventType | null;
  /** True for 3s after each event (for the flash banner) */
  showFlash: boolean;
  /** Type of the event currently flashing */
  flashType: IntegrityEventType | null;
  /** Forget all recorded events (e.g. between attempts) */
  clear: () => void;
}

const EMPTY_COUNTS: Record<IntegrityEventType, number> = {
  blur: 0,
  visibilitychange: 0,
  fullscreenchange: 0,
  devtools: 0,
  paste: 0,
  contextmenu: 0,
};

const FLASH_MS = 3000;
const DEVTOOLS_SIZE_DELTA = 180;
const DEVTOOLS_THROTTLE_MS = 2000;
/** Client-side cap — the server schema also caps at 500; drop the oldest beyond this. */
const MAX_EVENTS = 500;

/**
 * Detect and log assessment-integrity events.
 *
 * @param active - Whether an assessment is currently in progress
 */
export function useAntiCheat(
  active: boolean,
  onFirstEvent?: (event: IntegrityEvent) => void,
): AntiCheatState {
  const eventsRef = useRef<IntegrityEvent[]>([]);
  const [count, setCount] = useState(0);
  const [counts, setCounts] = useState<Record<IntegrityEventType, number>>({ ...EMPTY_COUNTS });
  const [lastType, setLastType] = useState<IntegrityEventType | null>(null);
  const [showFlash, setShowFlash] = useState(false);
  const [flashType, setFlashType] = useState<IntegrityEventType | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const devtoolsAtRef = useRef(0);
  const firstEventNotifiedRef = useRef(false);

  const record = useCallback(
    (type: IntegrityEventType) => {
      const entry: IntegrityEvent = { at: Date.now(), type };
      // Bound memory: drop the oldest events once the cap is reached.
      if (eventsRef.current.length >= MAX_EVENTS) eventsRef.current.shift();
      eventsRef.current.push(entry);
      if (!firstEventNotifiedRef.current) {
        firstEventNotifiedRef.current = true;
        onFirstEvent?.(entry);
      }
      setCount(eventsRef.current.length);
      setCounts((prev) => ({ ...prev, [type]: prev[type] + 1 }));
      setLastType(type);

      // Flash for 3 seconds
      setFlashType(type);
      setShowFlash(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setShowFlash(false), FLASH_MS);
    },
    [onFirstEvent],
  );

  const clear = useCallback(() => {
    eventsRef.current = [];
    setCount(0);
    setCounts({ ...EMPTY_COUNTS });
    setLastType(null);
    setShowFlash(false);
    setFlashType(null);
    firstEventNotifiedRef.current = false;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

  useEffect(() => {
    if (!active) return;

    // A single tab switch fires BOTH `blur` and `visibilitychange`; collapse
    // them into one logical event so the count isn't inflated.
    let lastTabSignal = 0;
    const recordTabSignal = (type: IntegrityEventType) => {
      const now = Date.now();
      if (now - lastTabSignal < 400) return;
      lastTabSignal = now;
      record(type);
    };

    const handleBlur = () => recordTabSignal("blur");
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") recordTabSignal("visibilitychange");
    };
    let enteredFullscreen = !!document.fullscreenElement;
    const handleFullscreen = () => {
      // Ignore initialization/redundant events; only a real exit is a violation.
      if (document.fullscreenElement) enteredFullscreen = true;
      else if (enteredFullscreen) {
        enteredFullscreen = false;
        record("fullscreenchange");
      }
    };
    const handlePaste = () => record("paste");
    const handleContextMenu = (e: MouseEvent) => {
      // Long-pressing a text field on mobile opens the native context menu for
      // legitimate paste/select — don't flag that as cheating.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      record("contextmenu");
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const devtoolsCombo =
        key === "f12" ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(key)) ||
        ((e.ctrlKey || e.metaKey) && key === "u");
      if (devtoolsCombo) {
        e.preventDefault();
        record("devtools");
      }
    };

    // Window-size heuristic: docked devtools shrink the viewport well below the
    // outer window. Throttled so a single open only records once. Skipped when
    // the browser doesn't expose a meaningful outer size (e.g. some mobile UAs).
    const handleResize = () => {
      if (window.outerWidth <= 0 || window.outerHeight <= 0) return;
      const widthDelta = window.outerWidth - window.innerWidth;
      const heightDelta = window.outerHeight - window.innerHeight;
      if (widthDelta > DEVTOOLS_SIZE_DELTA || heightDelta > DEVTOOLS_SIZE_DELTA) {
        const now = Date.now();
        if (now - devtoolsAtRef.current > DEVTOOLS_THROTTLE_MS) {
          devtoolsAtRef.current = now;
          record("devtools");
        }
      }
    };

    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);
    document.addEventListener("fullscreenchange", handleFullscreen);
    document.addEventListener("paste", handlePaste, true);
    document.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener("fullscreenchange", handleFullscreen);
      document.removeEventListener("paste", handlePaste, true);
      document.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [active, record]);

  // Reset when assessment ends
  useEffect(() => {
    if (!active) clear();
  }, [active, clear]);

  return {
    events: eventsRef.current,
    tabSwitches: eventsRef.current,
    count,
    switchCount: count,
    counts,
    lastType,
    showFlash,
    flashType,
    clear,
  };
}
