import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Trash2, Zap, Info, MousePointer2, Spline } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  resolvePartStates,
  BREADBOARD_GROUPS,
  type ArduinoBoardState,
  type CircuitPart,
  type CircuitPartType,
  type PartVisualState,
  type UnoPinRef,
  type WireEndpoint,
  type WireSpec,
} from "@/lib/arduino-simulator";
import type { ArduinoTask, TaskGuide } from "@/lib/arduino-tasks";

// Ensure @wokwi/elements custom elements are registered in browser
if (typeof window !== "undefined") {
  import("@wokwi/elements").catch(console.error);
}

export type WokwiComponentType = CircuitPartType;

export interface CanvasPart {
  id: string;
  type: WokwiComponentType;
  x: number;
  y: number;
  label: string;
  color?: string | undefined; // for LED: 'red', 'green', 'blue', 'yellow'
  value?: number | undefined; // potentiometer wiper / sonar distance / button pressed
}

/** Jumper wire snapped pin-to-pin between two real terminals. */
export type CanvasWire = WireSpec;

// Available jumper wire colors
const WIRE_COLORS = [
  { name: "Green", stroke: "#10b981" },
  { name: "Amber", stroke: "#f59e0b" },
  { name: "Cyan", stroke: "#06b6d4" },
  { name: "Rose", stroke: "#f43f5e" },
  { name: "Purple", stroke: "#a855f7" },
  { name: "Blue", stroke: "#3b82f6" },
  { name: "Black", stroke: "#111111" },
];

/* ────────────────────────────────────────────────────────────
 * Terminal geometry (Tinkercad-style real terminals)
 * Offsets are relative to the part's top-left corner.
 * ──────────────────────────────────────────────────────────── */

interface TerminalDef {
  id: string;
  x: number;
  y: number;
  label: string;
}

interface PartLayout {
  w: number;
  h: number;
  /** wokwi element natural size + absolute position inside the box */
  el: { x: number; y: number; w: number; h: number };
  terminals: TerminalDef[];
}

const PART_LAYOUTS: Record<WokwiComponentType, PartLayout> = {
  breadboard: {
    w: 548,
    h: 310,
    el: { x: 0, y: 28, w: 548, h: 270 },
    terminals: BREADBOARD_GROUPS.flat().map((id) => {
      const rail = /^(top|bottom)([+-])(\d+)$/.exec(id);
      const column = Number(rail ? rail[3] : id.slice(1));
      const row = "abcdefghij".indexOf(id[0]!);
      return {
        id,
        label: id,
        x: 24 + (column - 1) * 17,
        y: rail
          ? (rail[1] === "top" ? 48 : 266) + (rail[2] === "-" ? 16 : 0)
          : 90 + row * 14 + (row >= 5 ? 20 : 0),
      };
    }),
  },
  "wokwi-led": {
    w: 96,
    h: 118,
    el: { x: 28, y: 22, w: 40, h: 50 },
    terminals: [
      { id: "K", x: 30, y: 102, label: "K" },
      { id: "A", x: 66, y: 102, label: "A" },
    ],
  },
  "wokwi-pushbutton": {
    w: 132,
    h: 104,
    el: { x: 32, y: 26, w: 68, h: 46 },
    terminals: [
      { id: "leg1", x: 10, y: 58, label: "leg1" },
      { id: "leg2", x: 122, y: 58, label: "leg2" },
    ],
  },
  "wokwi-potentiometer": {
    w: 190,
    h: 158,
    el: { x: 42, y: 24, w: 76, h: 76 },
    terminals: [
      { id: "VCC", x: 10, y: 44, label: "VCC" },
      { id: "SIG", x: 180, y: 62, label: "SIG" },
      { id: "GND", x: 10, y: 104, label: "GND" },
    ],
  },
  "wokwi-buzzer": {
    w: 116,
    h: 112,
    el: { x: 30, y: 22, w: 52, h: 56 },
    terminals: [
      { id: "plus", x: 10, y: 46, label: "+" },
      { id: "minus", x: 10, y: 84, label: "−" },
    ],
  },
  "wokwi-servo": {
    w: 200,
    h: 170,
    el: { x: 20, y: 24, w: 170, h: 119 },
    terminals: [
      { id: "signal", x: 10, y: 46, label: "SIG" },
      { id: "VCC", x: 10, y: 78, label: "VCC" },
      { id: "GND", x: 10, y: 110, label: "GND" },
    ],
  },
  "wokwi-hc-sr04": {
    w: 214,
    h: 172,
    el: { x: 22, y: 22, w: 170, h: 95 },
    terminals: [
      { id: "VCC", x: 38, y: 124, label: "VCC" },
      { id: "TRIG", x: 88, y: 124, label: "TRIG" },
      { id: "ECHO", x: 138, y: 124, label: "ECHO" },
      { id: "GND", x: 188, y: 124, label: "GND" },
    ],
  },
  "wokwi-resistor": {
    w: 150,
    h: 72,
    el: { x: 45, y: 30, w: 60, h: 12 },
    terminals: [
      { id: "leg1", x: 12, y: 38, label: "leg1" },
      { id: "leg2", x: 138, y: 38, label: "leg2" },
    ],
  },
};

/* ────────────────────────────────────────────────────────────
 * Arduino Uno header pin coordinates
 * The wokwi-arduino-uno element renders at 72.58mm × 53.34mm
 * (274.2 × 201.5 px at 96dpi); its pin headers sit at known mm
 * positions inside the SVG (viewBox origin x = -4mm).
 * ──────────────────────────────────────────────────────────── */

const MM = 96 / 25.4; // px per mm
const UNO_W = 72.58 * MM;
const UNO_H = 53.34 * MM;

// Pin center positions in element-mm space (see @wokwi/elements header groups)
const UNO_DIGITAL_MM: Record<number, number> = {
  13: 28.93,
  12: 31.47,
  11: 34.01,
  10: 36.55,
  9: 39.09,
  8: 41.63,
  7: 45.69,
  6: 48.23,
  5: 50.77,
  4: 53.31,
  3: 55.85,
  2: 58.39,
  1: 60.93,
  0: 63.47,
};
const UNO_ANALOG_MM = [50.77, 53.31, 55.85, 58.39, 60.93, 63.47]; // A0..A5
const UNO_POWER_MM: Record<string, number> = {
  "3V3": 32.99,
  "5V": 35.53,
  GND: 38.07,
  GND2: 40.61,
};
const UNO_TOP_Y_MM = 3.6;
const UNO_BOTTOM_Y_MM = 49.6;

interface UnoTerminal {
  key: string;
  pin: UnoPinRef | "GND2";
  label: string;
  mmX: number;
  mmY: number;
}

function buildUnoTerminals(): UnoTerminal[] {
  return [
    ...[13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((n) => ({
      key: `uno-D${n}`,
      pin: n as UnoPinRef | "GND2",
      label: `${n}`,
      mmX: UNO_DIGITAL_MM[n]!,
      mmY: UNO_TOP_Y_MM,
    })),
    ...[
      {
        key: "uno-3V3",
        pin: "3V3" as UnoPinRef | "GND2",
        label: "3.3V",
        mmX: UNO_POWER_MM["3V3"]!,
        mmY: UNO_BOTTOM_Y_MM,
      },
      {
        key: "uno-5V",
        pin: "5V" as UnoPinRef | "GND2",
        label: "5V",
        mmX: UNO_POWER_MM["5V"]!,
        mmY: UNO_BOTTOM_Y_MM,
      },
      {
        key: "uno-GND",
        pin: "GND" as UnoPinRef | "GND2",
        label: "GND",
        mmX: UNO_POWER_MM["GND"]!,
        mmY: UNO_BOTTOM_Y_MM,
      },
      {
        key: "uno-GND2",
        pin: "GND2" as UnoPinRef | "GND2",
        label: "GND",
        mmX: UNO_POWER_MM["GND2"]!,
        mmY: UNO_BOTTOM_Y_MM,
      },
    ],
    ...[0, 1, 2, 3, 4, 5].map((a) => ({
      key: `uno-A${a}`,
      pin: (14 + a) as UnoPinRef | "GND2",
      label: `A${a}`,
      mmX: UNO_ANALOG_MM[a]!,
      mmY: UNO_BOTTOM_Y_MM,
    })),
  ];
}

const UNO_TERMINALS: UnoTerminal[] = buildUnoTerminals();

/** Wire endpoint for a Uno terminal key ("GND2" shares the GND net). */
function unoTerminalEndpoint(t: UnoTerminal): WireEndpoint {
  return { kind: "uno", pin: t.pin === "GND2" ? "GND" : (t.pin as UnoPinRef) };
}

function endpointKey(e: WireEndpoint): string {
  return e.kind === "uno" ? `uno-${e.pin}` : `part-${e.partId}-${e.terminal}`;
}

/* Clean wire geometry: straight when terminals align, otherwise a
 * soft cubic bezier with a natural droop (never a cheap straight line). */
function wirePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 6) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const sag = Math.min(80, 26 + Math.abs(dx) * 0.16 + Math.abs(dy) * 0.06);
  return `M ${a.x} ${a.y} C ${a.x + dx * 0.28} ${a.y + sag} ${b.x - dx * 0.28} ${b.y + sag} ${b.x} ${b.y}`;
}

function nextLabel(list: CanvasPart[], type: WokwiComponentType): string {
  const prefix =
    type === "wokwi-led"
      ? "LED"
      : type === "wokwi-pushbutton"
        ? "button"
        : type === "wokwi-potentiometer"
          ? "pot"
          : type === "wokwi-buzzer"
            ? "buzzer"
            : type === "wokwi-servo"
              ? "servo"
              : type === "wokwi-hc-sr04"
                ? "sonar"
                : type === "breadboard"
                  ? "breadboard"
                  : "resistor";
  let n = 1;
  while (list.some((p) => p.label === `${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

interface InteractiveBreadboardCanvasProps {
  boardState: ArduinoBoardState | null;
  isRunning: boolean;
  /** Selected seeded task — places its parts (unwired) + dashed ghost guide */
  task?: ArduinoTask | null;
  /** Fires whenever the student's parts/wiring change (drives netlist + summary) */
  onCircuitChange?: (parts: CircuitPart[], wires: CanvasWire[]) => void;
}

let wireSeq = 0;
function nextWireId(): string {
  wireSeq += 1;
  return `wire-${Date.now().toString(36)}-${wireSeq}`;
}

export function InteractiveBreadboardCanvas({
  boardState,
  isRunning,
  task,
  onCircuitChange,
}: InteractiveBreadboardCanvasProps) {
  // Parts start EMPTY — students place everything from the palette.
  const [parts, setParts] = useState<CanvasPart[]>([]);
  const [wires, setWires] = useState<CanvasWire[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  // Top-left origin inside workbench container with safe padding
  const [unoPos, setUnoPos] = useState({ x: 36, y: 36 });

  /* ---------- Manual pin-to-pin wiring (Tinkercad-style) ---------- */
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState<string>(WIRE_COLORS[0]?.stroke ?? "#10b981");
  /** Anchor terminal of the wire being drawn */
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [ghostGuides, setGhostGuides] = useState<TaskGuide[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    elemX: number;
    elemY: number;
  } | null>(null);
  const wireDraggingRef = useRef(false);

  /* ---------- Terminal registry (key → canvas coordinate) ---------- */
  const unoCoord = useCallback(
    (t: { mmX: number; mmY: number }) => ({
      x: unoPos.x + (t.mmX + 4) * MM,
      y: unoPos.y + t.mmY * MM,
    }),
    [unoPos],
  );

  const partTerminalCoord = useCallback(
    (partId: string, terminal: string): { x: number; y: number } | null => {
      const part = parts.find((p) => p.id === partId);
      if (!part) return null;
      const def = PART_LAYOUTS[part.type].terminals.find((t) => t.id === terminal);
      if (!def) return null;
      return { x: part.x + def.x, y: part.y + def.y };
    },
    [parts],
  );

  const endpointCoord = useCallback(
    (e: WireEndpoint): { x: number; y: number } | null => {
      if (e.kind === "uno") {
        const t = UNO_TERMINALS.find(
          (u) => u.pin === e.pin || (e.pin === "GND" && u.pin === "GND2"),
        );
        return t ? unoCoord(t) : null;
      }
      return partTerminalCoord(e.partId, e.terminal);
    },
    [unoCoord, partTerminalCoord],
  );

  /* Which endpoint a terminal key refers to */
  const keyToEndpoint = useCallback(
    (key: string): WireEndpoint | null => {
      const unoT = UNO_TERMINALS.find((u) => u.key === key);
      if (unoT) return unoTerminalEndpoint(unoT);
      for (const p of parts) {
        for (const t of PART_LAYOUTS[p.type].terminals) {
          if (`part-${p.id}-${t.id}` === key) {
            return { kind: "part", partId: p.id, terminal: t.id };
          }
        }
      }
      return null;
    },
    [parts],
  );

  /* ---------- Netlist-driven part visuals ---------- */
  const circuitParts: CircuitPart[] = useMemo(
    () =>
      parts.map((p) => ({
        id: p.id,
        type: p.type,
        label: p.label,
        value: p.value,
        pressed: p.type === "wokwi-pushbutton" && p.value === 1,
      })),
    [parts],
  );

  const visuals: Record<string, PartVisualState> = useMemo(
    () => resolvePartStates(circuitParts, wires, boardState),
    [circuitParts, wires, boardState],
  );

  const onCircuitChangeRef = useRef(onCircuitChange);
  onCircuitChangeRef.current = onCircuitChange;
  useEffect(() => {
    onCircuitChangeRef.current?.(circuitParts, wires);
  }, [circuitParts, wires]);

  /* ---------- Seeded task: place parts + dashed ghost guide (no solid wires) ---------- */
  useEffect(() => {
    if (!task) {
      setGhostGuides([]);
      setParts((prev) => prev.filter((part) => !part.id.startsWith("task-")));
      setWires((prev) =>
        prev.filter((wire) =>
          [wire.from, wire.to].every(
            (endpoint) => endpoint.kind !== "part" || !endpoint.partId.startsWith("task-"),
          ),
        ),
      );
      return;
    }
    const seededIds = new Set(task.parts.map((sp) => `task-${sp.key}`));
    setParts((prev) => {
      const kept = prev.filter((p) => !p.id.startsWith("task-"));
      // Seeded labels stay unique against parts the student already placed,
      // and seed positions shift when they would land on top of one.
      const all: CanvasPart[] = [...kept];
      const seeded = task.parts.map<CanvasPart>((sp) => {
        let { x, y } = sp;
        for (let i = 0; i < 8; i += 1) {
          const collides = all.some((p) => Math.abs(p.x - x) < 120 && Math.abs(p.y - y) < 130);
          if (!collides) break;
          y += 180;
          if (y > 460) {
            y = 70;
            x += 150;
          }
        }
        const part: CanvasPart = {
          id: `task-${sp.key}`,
          type: sp.type,
          x,
          y,
          label: nextLabel(all, sp.type),
          color: sp.color,
          value: sp.type === "wokwi-potentiometer" ? 512 : sp.type === "wokwi-hc-sr04" ? 25 : 0,
        };
        all.push(part);
        return part;
      });
      return [...kept, ...seeded];
    });
    // Drop any wires that pointed at task parts from a previously selected task
    setWires((prev) =>
      prev.filter((wr) =>
        [wr.from, wr.to].every(
          (e) => e.kind !== "part" || !e.partId.startsWith("task-") || seededIds.has(e.partId),
        ),
      ),
    );
    setGhostGuides(task.guides);
  }, [task]);

  /* ---------- Pointer helpers ---------- */
  const localPoint = (e: React.MouseEvent | MouseEvent | PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** Terminal key under the cursor (for snapping + drag-release). */
  const terminalAtPoint = (clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const holder = el?.closest?.("[data-term-key]") as HTMLElement | null;
    return holder?.dataset["termKey"] ?? null;
  };

  /* ---------- Wire creation ---------- */
  const endpointsEqual = (a: WireEndpoint, b: WireEndpoint) => endpointKey(a) === endpointKey(b);

  const createWire = useCallback(
    (fromKey: string, toKey: string) => {
      const from = keyToEndpoint(fromKey);
      const to = keyToEndpoint(toKey);
      if (!from || !to || endpointsEqual(from, to)) return;
      setWires((prev) => {
        const dup = prev.some(
          (w) =>
            (endpointsEqual(w.from, from) && endpointsEqual(w.to, to)) ||
            (endpointsEqual(w.from, to) && endpointsEqual(w.to, from)),
        );
        if (dup) return prev;
        return [...prev, { id: nextWireId(), from, to, color: drawColor }];
      });
      setPendingKey(null);
      setCursorPos(null);
      wireDraggingRef.current = false;
    },
    [keyToEndpoint, drawColor],
  );

  /* Escape cancels an in-progress wire (second Esc leaves wire mode) */
  useEffect(() => {
    if (!drawMode && !pendingKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pendingKey) {
          setPendingKey(null);
          setCursorPos(null);
          wireDraggingRef.current = false;
        } else {
          setDrawMode(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawMode, pendingKey]);

  /* Delete/Backspace removes the selected wire (or selected part) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      if (selectedWireId) {
        e.preventDefault();
        setWires((prev) => prev.filter((w) => w.id !== selectedWireId));
        setSelectedWireId(null);
      } else if (selectedId && selectedId !== "arduino-uno") {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWireId, selectedId]);

  /* ---------- Terminal interactions ---------- */
  const handleTerminalDown = (e: React.PointerEvent, key: string) => {
    e.stopPropagation();
    // Allow wiring in both drawMode AND select mode (seamless wiring experience)
    if (!pendingKey) {
      setPendingKey(key);
      setCursorPos(localPoint(e));
      wireDraggingRef.current = true;
    } else if (pendingKey === key) {
      setPendingKey(null);
      setCursorPos(null);
      wireDraggingRef.current = false;
    } else {
      createWire(pendingKey, key);
    }
  };

  const handleTerminalClick = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    if (pendingKey && pendingKey !== key) {
      createWire(pendingKey, key);
      return;
    }
    if (!drawMode && !pendingKey) {
      // Select mode without pending wire: clicking a terminal selects its part
      const ep = keyToEndpoint(key);
      if (ep?.kind === "part") {
        setSelectedId(ep.partId);
        setSelectedWireId(null);
      } else {
        setSelectedId("arduino-uno");
        setSelectedWireId(null);
      }
    }
  };

  /* ---------- Global pointer move / up (drag + wire routing) ---------- */
  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (dragRef.current && containerRef.current) {
      const { id, startX, startY, elemX, elemY } = dragRef.current;
      const rect = containerRef.current.getBoundingClientRect();
      const newX = Math.max(16, Math.min(rect.width - 290, elemX + (e.clientX - startX)));
      const newY = Math.max(50, Math.min(rect.height - 220, elemY + (e.clientY - startY)));
      if (id === "arduino-uno") {
        setUnoPos({ x: newX, y: newY });
      } else {
        setParts((prev) => prev.map((p) => (p.id === id ? { ...p, x: newX, y: newY } : p)));
      }
    }
    if (wireDraggingRef.current) {
      setCursorPos(localPoint(e));
      setHoverKey(terminalAtPoint(e.clientX, e.clientY));
    }
  }, []);

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      dragRef.current = null;
      if (wireDraggingRef.current && pendingKey) {
        const target = terminalAtPoint(e.clientX, e.clientY);
        if (target && target !== pendingKey) {
          createWire(pendingKey, target);
        }
      }
      wireDraggingRef.current = false;
    },
    [pendingKey, createWire],
  );

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  /* ---------- Part dragging ---------- */
  const handlePartDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    setSelectedId(id);
    setSelectedWireId(null);
    const item =
      id === "arduino-uno" ? { x: unoPos.x, y: unoPos.y } : parts.find((p) => p.id === id);
    if (!item) return;
    dragRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      elemX: item.x,
      elemY: item.y,
    };
    wireDraggingRef.current = false;
  };

  /* ---------- Palette ---------- */
  const addPart = (type: WokwiComponentType, at?: { x: number; y: number }) => {
    const layout = PART_LAYOUTS[type];
    setParts((prev) => {
      const idx = prev.length;
      const x = at ? at.x : 460 + (idx % 3) * 190;
      const y = at ? at.y : 60 + Math.floor(idx / 3) * 190;
      const id = `${type}-${Date.now().toString(36)}-${idx}`;
      const newPart: CanvasPart = {
        id,
        type,
        x: Math.max(4, Math.min(x, 1080 - layout.w)),
        y: Math.max(4, Math.min(y, 620 - layout.h)),
        label: nextLabel(prev, type),
        color: type === "wokwi-led" ? "red" : type === "wokwi-pushbutton" ? "red" : undefined,
        value: type === "wokwi-potentiometer" ? 512 : type === "wokwi-hc-sr04" ? 25 : 0,
      };
      setSelectedId(id);
      return [...prev, newPart];
    });
  };

  const removeSelected = () => {
    if (!selectedId || selectedId === "arduino-uno") return;
    setParts((prev) => prev.filter((p) => p.id !== selectedId));
    // Dangling wires die with their part
    setWires((prev) =>
      prev.filter(
        (w) =>
          !(w.from.kind === "part" && w.from.partId === selectedId) &&
          !(w.to.kind === "part" && w.to.partId === selectedId),
      ),
    );
    setSelectedId(null);
  };

  const removeWire = (id: string) => {
    setWires((prev) => prev.filter((w) => w.id !== id));
    setSelectedWireId(null);
  };

  const handlePushButton = (part: CanvasPart) => {
    const nextVal = part.value === 1 ? 0 : 1;
    setParts((prev) => prev.map((p) => (p.id === part.id ? { ...p, value: nextVal } : p)));
  };

  const updatePartValue = (part: CanvasPart, value: number) => {
    setParts((prev) => prev.map((p) => (p.id === part.id ? { ...p, value } : p)));
  };

  /* ---------- Canvas click clears selection ---------- */
  const handleCanvasClick = () => {
    if (!drawMode) {
      setSelectedId(null);
      setSelectedWireId(null);
    }
  };

  const selectedPart = parts.find((p) => p.id === selectedId);
  // Grow the scrollable surface with its contents so large boards and moved
  // components remain reachable instead of being clipped by the canvas edge.
  const workbenchWidth = Math.max(
    1080,
    unoPos.x + UNO_W + 36,
    ...parts.map((part) => part.x + PART_LAYOUTS[part.type].w + 36),
  );
  const workbenchHeight = Math.max(
    620,
    unoPos.y + UNO_H + 36,
    ...parts.map((part) => part.y + PART_LAYOUTS[part.type].h + 36),
  );

  /* ---------- Rendering helpers ---------- */
  const renderTerminal = (
    key: string,
    coord: { x: number; y: number },
    label: string,
    accent = "#94a3b8",
    onDown?: (e: React.PointerEvent) => void,
    testid?: string,
    stub?: { x1: number; y1: number; x2: number; y2: number },
    showLabel = true,
  ) => {
    const isHover = hoverKey === key;
    const isPending = pendingKey === key;
    const isSnap = Boolean(pendingKey) && hoverKey === key && pendingKey !== key;
    const isBreadboard = key.startsWith("part-breadboard-");
    const r = isBreadboard ? 3.5 : isPending || isSnap ? 8.5 : isHover ? 7.5 : 6;
    return (
      <g key={key}>
        {stub && (
          <line
            x1={stub.x1}
            y1={stub.y1}
            x2={stub.x2}
            y2={stub.y2}
            stroke="#475569"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ pointerEvents: "none" }}
          />
        )}
        <circle
          cx={coord.x}
          cy={coord.y}
          r={r + 8}
          fill={
            isSnap ? "rgba(52,211,153,0.4)" : isPending ? "rgba(52,211,153,0.3)" : "transparent"
          }
          style={{ pointerEvents: "none" }}
        />
        <circle
          cx={coord.x}
          cy={coord.y}
          r={r}
          fill={isPending || isSnap ? "#34d399" : accent}
          stroke={isPending || isSnap ? "#a7f3d0" : "#475569"}
          strokeWidth="2"
          style={{ pointerEvents: "none" }}
        />
        {(showLabel || isHover || isPending) && (
          <text
            x={coord.x}
            y={coord.y - 10}
            textAnchor="middle"
            fontSize="9"
            fontWeight="bold"
            fontFamily="ui-monospace, monospace"
            fill={isPending || isSnap ? "#6ee7b7" : "#cbd5e1"}
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {label}
          </text>
        )}
        <ellipse
          cx={coord.x}
          cy={coord.y}
          // Uno pins are about 15px apart: keep their targets separate while
          // retaining a generous vertical target for touch wiring.
          rx={isBreadboard ? 7 : key.startsWith("uno-") ? 7 : 16}
          ry={isBreadboard ? 6 : 16}
          fill="transparent"
          data-term-key={key}
          data-testid={testid}
          onPointerDown={(e) => onDown?.(e)}
          onClick={(e) => handleTerminalClick(e, key)}
          role="button"
          aria-label={`Connect ${label}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.currentTarget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }
          }}
          onPointerEnter={() => setHoverKey(key)}
          onPointerLeave={() => setHoverKey((h) => (h === key ? null : h))}
          style={{
            pointerEvents: "auto",
            cursor: "pointer",
            touchAction: "none",
          }}
        />
      </g>
    );
  };

  const renderWirePath = (
    id: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    color: string,
    dashed: boolean,
    selectable: boolean,
  ) => {
    const d = wirePath(from, to);
    const isSelected = id === selectedWireId;
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + 18 };
    return (
      <g key={id}>
        {dashed ? (
          <path
            d={d}
            fill="none"
            stroke="#64748b"
            strokeWidth="2.5"
            strokeDasharray="6 7"
            strokeOpacity="0.55"
            strokeLinecap="round"
            style={{ pointerEvents: "none" }}
            data-testid="ghost-guide"
          />
        ) : (
          <>
            <path
              d={d}
              fill="none"
              stroke={color === "#111111" ? "#94a3b8" : "#000000"}
              strokeOpacity="0.45"
              strokeWidth={isSelected ? 8 : 6}
              strokeLinecap="round"
              style={{ pointerEvents: "none" }}
            />
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={isSelected ? 5 : 3.4}
              strokeLinecap="round"
              filter={color === "#111111" ? undefined : "url(#wire-glow)"}
              style={{ pointerEvents: "none" }}
            />
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              style={{
                pointerEvents: selectable && !drawMode ? "stroke" : "none",
                cursor: "pointer",
              }}
              onClick={(e) => {
                if (drawMode) return;
                e.stopPropagation();
                setSelectedWireId(id);
                setSelectedId(null);
              }}
            />
            {isSelected && (
              <g
                data-testid={`wire-del-${id}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  removeWire(id);
                }}
                style={{ pointerEvents: "auto", cursor: "pointer" }}
              >
                <circle
                  cx={mid.x}
                  cy={mid.y}
                  r={11}
                  fill="#1f2937"
                  stroke="#f43f5e"
                  strokeWidth="1.5"
                />
                <line
                  x1={mid.x - 3.5}
                  y1={mid.y - 3.5}
                  x2={mid.x + 3.5}
                  y2={mid.y + 3.5}
                  stroke="#f43f5e"
                  strokeWidth="2"
                />
                <line
                  x1={mid.x + 3.5}
                  y1={mid.y - 3.5}
                  x2={mid.x - 3.5}
                  y2={mid.y + 3.5}
                  stroke="#f43f5e"
                  strokeWidth="2"
                />
              </g>
            )}
          </>
        )}
      </g>
    );
  };

  return (
    <div className="min-w-0 w-full max-w-full space-y-4">
      {/* Component Palette Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card/90 p-3.5 shadow-sm backdrop-blur-md">
        {/* Row 1: Primary Controls & Tools */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-1">
              Wiring Mode:
            </span>
            {/* Tool toggle: Select vs Draw wire (both support click-to-wire) */}
            <div className="flex items-center rounded-lg border border-border/70 bg-background p-0.5">
              <button
                onClick={() => {
                  setDrawMode(false);
                  setPendingKey(null);
                  setCursorPos(null);
                }}
                aria-pressed={!drawMode}
                title="Select, move and press components (you can still click terminals to wire!)"
                data-testid="tool-select"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
                  !drawMode
                    ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 shadow-inner"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <MousePointer2 className="h-3.5 w-3.5" /> Select / Move
              </button>
              <button
                onClick={() => {
                  setDrawMode((v) => !v);
                  setPendingKey(null);
                  setCursorPos(null);
                  setSelectedWireId(null);
                }}
                aria-pressed={drawMode}
                title="Draw a jumper wire between two terminals"
                data-testid="tool-wire"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
                  drawMode
                    ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 shadow-inner"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Spline className="h-3.5 w-3.5" /> Draw Wire
              </button>
            </div>

            {ghostGuides.length > 0 && (
              <button
                type="button"
                data-testid="auto-wire-task"
                onClick={() => {
                  ghostGuides.forEach((g) => {
                    const from = endpointCoord(g.from);
                    const to = endpointCoord(g.to);
                    if (!from || !to) return;
                    const fKey = endpointKey(g.from);
                    const tKey = endpointKey(g.to);
                    createWire(fKey, tKey);
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/25 transition shadow-sm"
                title="Automatically connect all guide wires for this task"
              >
                <Zap className="h-3.5 w-3.5 text-amber-400" /> Auto-Wire Task
              </button>
            )}

            {wires.length > 0 && (
              <button
                type="button"
                data-testid="clear-all-wires"
                onClick={() => {
                  setWires([]);
                  setSelectedWireId(null);
                  setPendingKey(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition shadow-sm"
                title="Clear all jumper wires"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear Wires
              </button>
            )}
          </div>

          {/* Wire Colors & Selection Status */}
          <div className="flex flex-wrap items-center gap-2">
            {pendingKey ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-900 dark:text-emerald-200 animate-pulse">
                <span>
                  From:{" "}
                  <strong className="text-white underline">
                    {pendingKey.replace("term-", "").replace("part-", "")}
                  </strong>{" "}
                  → click pin
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPendingKey(null);
                    setCursorPos(null);
                    wireDraggingRef.current = false;
                  }}
                  className="ml-1 rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 bg-background/60 border border-border/60 rounded-lg px-2 py-1">
                <span className="text-[11px] font-medium text-muted-foreground mr-1">
                  Wire Color:
                </span>
                {WIRE_COLORS.map((w) => (
                  <button
                    key={w.name}
                    type="button"
                    onClick={() => setDrawColor(w.stroke)}
                    aria-label={`${w.name} jumper wire`}
                    aria-pressed={drawColor === w.stroke}
                    data-testid={`wire-color-${w.name}`}
                    className={cn(
                      "h-3.5 w-3.5 rounded-full border border-slate-400 transition-transform focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
                      drawColor === w.stroke
                        ? "scale-125 ring-2 ring-white"
                        : "opacity-75 hover:opacity-100 hover:scale-110",
                    )}
                    style={{ backgroundColor: w.stroke }}
                    title={`${w.name} wire`}
                  />
                ))}
              </div>
            )}

            {selectedWireId && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => removeWire(selectedWireId)}
                  data-testid="remove-wire"
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition"
                  title="Delete selected wire"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove wire
                </button>
              </div>
            )}

            {selectedPart &&
              !drawMode &&
              (() => {
                const selVisual = visuals[selectedPart.id];
                return (
                  <div className="flex items-center gap-2 rounded-lg bg-background/60 border border-border/60 px-2.5 py-1">
                    <span className="text-xs text-muted-foreground">
                      Selected: <strong className="text-foreground">{selectedPart.label}</strong>
                      {selVisual && (
                        <span className="ml-1 font-mono text-[10px] text-emerald-800 dark:text-emerald-300">
                          {selVisual.connectedPins.length > 0
                            ? `→ ${selVisual.connectedPins.join(", ")}`
                            : "→ unwired"}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={removeSelected}
                      data-testid="remove-part"
                      className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/20 transition ml-1"
                      title="Delete component"
                    >
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                  </div>
                );
              })()}
          </div>
        </div>

        {/* Row 2: Real Hardware Parts Palette */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-1">
            Hardware Palette:
          </span>
          {(
            [
              ["wokwi-led", "LED", "bg-red-500"],
              ["wokwi-pushbutton", "Push Button", "bg-blue-500"],
              ["wokwi-potentiometer", "Potentiometer", "bg-amber-500"],
              ["wokwi-buzzer", "Buzzer", "bg-sky-400"],
              ["wokwi-servo", "SG90 Servo", "bg-rose-400"],
              ["wokwi-hc-sr04", "Sonar", "bg-teal-400"],
              ["wokwi-resistor", "220Ω Resistor", "bg-amber-600"],
              ["breadboard", "Breadboard", "bg-slate-600"],
            ] as const
          ).map(([type, label, dot]) => (
            <button
              key={type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/miow-part", type);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => addPart(type)}
              data-testid={`palette-${type}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted cursor-grab active:cursor-grabbing"
              title="Click to add, or drag onto the workbench"
            >
              <div className={cn("h-2.5 w-2.5 rounded-full shadow-sm", dot)} />+ {label}
            </button>
          ))}
        </div>
      </div>

      {/* Preserve the circuit's 1080px coordinate space; smaller screens scroll. */}
      <div
        data-testid="workbench-scroll"
        tabIndex={0}
        role="region"
        aria-label="Circuit workbench. Scroll horizontally to reach all components."
        className="min-w-0 w-full max-w-full overflow-x-auto overscroll-x-contain rounded-2xl focus-visible:outline-2 focus-visible:outline-ring"
      >
        <div
          ref={containerRef}
          onClick={handleCanvasClick}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const type = e.dataTransfer.getData("text/miow-part") as WokwiComponentType;
            if (!type || !PART_LAYOUTS[type]) return;
            const rect = containerRef.current?.getBoundingClientRect();
            const x = rect ? e.clientX - rect.left - 30 : 460;
            const y = rect ? e.clientY - rect.top - 30 : 60;
            addPart(type, { x: Math.max(4, x), y: Math.max(4, y) });
          }}
          data-testid="arduino-workbench"
          className={cn(
            "relative w-full select-none overflow-hidden rounded-2xl border-2 shadow-2xl",
            dragOver ? "border-emerald-400 ring-2 ring-emerald-400/40" : "border-emerald-900/60",
            drawMode && "cursor-crosshair",
          )}
          style={{
            minWidth: workbenchWidth,
            height: workbenchHeight,
            backgroundImage: `
              radial-gradient(circle, rgba(148, 163, 184, 0.22) 1.5px, transparent 1.5px),
              radial-gradient(circle, rgba(148, 163, 184, 0.08) 1.5px, transparent 1.5px)
            `,
            backgroundSize: "28px 28px",
            backgroundPosition: "0 0, 14px 14px",
            backgroundColor: "#090d16",
          }}
        >
          {/* Jumpers sit above hardware, with terminal targets above both. */}
          <svg
            data-testid="workbench-wires"
            className="pointer-events-none absolute inset-0 h-full w-full z-30"
          >
            <defs>
              <filter id="wire-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            {/* Ghost wiring guides (dashed — never solid pre-placed wires) */}
            {ghostGuides.map((g, i) => {
              const from = endpointCoord(g.from);
              const to = endpointCoord(g.to);
              if (!from || !to) return null;
              return renderWirePath(`ghost-${i}`, from, to, "#64748b", true, false);
            })}
            {wires.map((w) => {
              const from = endpointCoord(w.from);
              const to = endpointCoord(w.to);
              if (!from || !to) return null;
              return renderWirePath(w.id, from, to, w.color, false, true);
            })}
          </svg>

          {/* Workbench Watermark Badge */}
          <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-2 rounded-lg bg-slate-900/90 px-3 py-1 font-mono text-[11px] text-slate-300 border border-slate-700/80 shadow-md z-30">
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            <span>Tinkercad-style Manual Wiring Workbench</span>
          </div>

          {/* ARDUINO UNO (draggable) */}
          <div
            onPointerDown={(e) => handlePartDown(e, "arduino-uno")}
            style={{
              left: unoPos.x,
              top: unoPos.y,
              width: UNO_W,
              height: UNO_H,
              touchAction: "none",
            }}
            className={cn(
              "absolute cursor-grab active:cursor-grabbing select-none rounded-lg transition-shadow z-20",
              selectedId === "arduino-uno" && "ring-2 ring-emerald-400 shadow-2xl",
            )}
            title="Draggable Arduino Uno R3"
            data-testid="arduino-uno"
          >
            {React.createElement("wokwi-arduino-uno", {
              led13: boardState?.builtinLed === 1,
              ledPower: isRunning,
              ledRX: false,
              ledTX: false,
              style: { width: `${UNO_W}px`, height: `${UNO_H}px` },
            })}
            <div
              className="absolute left-0 flex items-center justify-between font-mono text-[10px] text-slate-400 bg-slate-900/90 rounded border border-slate-800 px-2 py-0.5"
              style={{ top: UNO_H + 2, width: UNO_W }}
            >
              <span>Arduino Uno R3</span>
              <span className={cn("font-bold", isRunning ? "text-emerald-400" : "text-slate-500")}>
                {isRunning ? "PWR ON" : "STANDBY"}
              </span>
            </div>
          </div>

          {/* Parts (draggable) */}
          {parts.map((p) => {
            const layout = PART_LAYOUTS[p.type];
            const visual = visuals[p.id];
            const isSelected = p.id === selectedId;
            return (
              <div
                key={p.id}
                onPointerDown={(e) => handlePartDown(e, p.id)}
                style={{
                  left: p.x,
                  top: p.y,
                  width: layout.w,
                  height: layout.h,
                  touchAction: "none",
                }}
                data-testid={`part-${p.label}`}
                data-part-id={p.id}
                data-lit={p.type === "wokwi-led" ? (visual?.lit ? "true" : "false") : undefined}
                className={cn(
                  "absolute cursor-grab active:cursor-grabbing select-none rounded-xl transition-shadow z-20 group",
                  isSelected
                    ? "ring-2 ring-emerald-400 bg-slate-900/80 shadow-2xl border border-emerald-500/50"
                    : "hover:ring-1 hover:ring-slate-500/50 hover:bg-slate-900/40",
                )}
              >
                {/* Label + derived pin badge + wiring warning */}
                <div className="flex items-center justify-between gap-1 px-1 text-[10px] font-mono">
                  <span className="rounded bg-slate-800/90 px-1.5 py-0.2 text-slate-300 font-semibold border border-slate-700">
                    {p.label}
                  </span>
                  <span className="rounded px-1.5 py-0.2 font-bold border border-slate-600 bg-slate-700/80 text-slate-200">
                    {visual && visual.connectedPins.length > 0
                      ? visual.connectedPins.join("/")
                      : "—"}
                  </span>
                </div>
                {visual?.warning && (
                  <div
                    data-testid={`warning-${p.label}`}
                    className="mx-1 mt-0.5 rounded border border-amber-500/40 bg-amber-500/15 px-1 py-0.5 text-[8.5px] leading-tight text-amber-300"
                    title={visual.warning}
                  >
                    ⚠ {visual.warning}
                  </div>
                )}

                {/* Wokwi element — absolutely placed for terminal alignment */}
                <div
                  className="absolute flex items-center justify-center"
                  style={{
                    left: layout.el.x,
                    top: layout.el.y,
                    width: layout.el.w,
                    height: layout.el.h,
                  }}
                >
                  {p.type === "breadboard" && (
                    <svg
                      viewBox="0 0 548 270"
                      className="h-full w-full"
                      aria-label="Breadboard with 30 columns, rows a to j, and separate power rails"
                    >
                      <rect
                        x="1"
                        y="1"
                        width="546"
                        height="268"
                        rx="10"
                        fill="#f1f5f9"
                        stroke="#94a3b8"
                      />
                      {[20, 36, 238, 254].map((y, i) => (
                        <g key={y}>
                          <line
                            x1="12"
                            x2="536"
                            y1={y}
                            y2={y}
                            stroke={i % 2 ? "#2563eb" : "#dc2626"}
                          />
                          <text x="4" y={y + 3} fontSize="10" fill={i % 2 ? "#1d4ed8" : "#b91c1c"}>
                            {i % 2 ? "−" : "+"}
                          </text>
                        </g>
                      ))}
                      <rect x="8" y="128" width="532" height="12" rx="4" fill="#cbd5e1" />
                      {Array.from({ length: 30 }, (_, i) => (
                        <text
                          key={i}
                          x={24 + i * 17}
                          y="53"
                          textAnchor="middle"
                          fontSize="8"
                          fill="#334155"
                        >
                          {i + 1}
                        </text>
                      ))}
                      {"abcdefghij".split("").map((row, i) => (
                        <text
                          key={row}
                          x="7"
                          y={65 + i * 14 + (i >= 5 ? 20 : 0)}
                          fontSize="9"
                          fill="#334155"
                        >
                          {row}
                        </text>
                      ))}
                    </svg>
                  )}
                  {p.type === "wokwi-led" &&
                    React.createElement("wokwi-led", {
                      color: p.color || "red",
                      value: Boolean(visual?.lit),
                      lightColor: p.color || "red",
                    })}

                  {p.type === "wokwi-pushbutton" && (
                    <div
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePushButton(p);
                      }}
                      className="cursor-pointer active:scale-95 transition"
                      title="Click to press pushbutton"
                      data-testid={`press-${p.label}`}
                    >
                      {React.createElement("wokwi-pushbutton", {
                        color: p.color || "red",
                        pressed: p.value === 1,
                      })}
                    </div>
                  )}

                  {p.type === "wokwi-potentiometer" &&
                    React.createElement("wokwi-potentiometer", {
                      min: 0,
                      max: 1023,
                      value: p.value ?? 512,
                    })}

                  {p.type === "wokwi-buzzer" &&
                    React.createElement("wokwi-buzzer", {
                      hasSignal: Boolean(visual?.sounding),
                    })}

                  {p.type === "wokwi-servo" &&
                    React.createElement("wokwi-servo", {
                      angle: visual?.angle ?? 0,
                    })}

                  {p.type === "wokwi-hc-sr04" && React.createElement("wokwi-hc-sr04", {})}

                  {p.type === "wokwi-resistor" &&
                    React.createElement("wokwi-resistor", {
                      value: "220",
                    })}
                </div>

                {/* Interactive controls */}
                {p.type === "wokwi-potentiometer" && (
                  <div
                    className="absolute left-2 right-2 flex flex-col items-center gap-1"
                    style={{ top: 112 }}
                  >
                    <input
                      type="range"
                      min="0"
                      max="1023"
                      value={p.value ?? 512}
                      data-testid={`pot-${p.label}`}
                      onChange={(e) => updatePartValue(p, Number(e.target.value))}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-emerald-400"
                    />
                    <span className="font-mono text-[9px] text-slate-400">
                      {p.value ?? 512} ({(((p.value ?? 512) / 1023) * 5.0).toFixed(2)}V)
                    </span>
                  </div>
                )}
                {p.type === "wokwi-hc-sr04" && (
                  <div
                    className="absolute left-2 right-2 flex flex-col items-center gap-1"
                    style={{ top: 128 }}
                  >
                    <input
                      type="range"
                      min="2"
                      max="400"
                      value={p.value ?? 25}
                      data-testid={`sonar-${p.label}`}
                      onChange={(e) => updatePartValue(p, Number(e.target.value))}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-teal-400"
                    />
                    <span className="font-mono text-[9px] text-teal-400">
                      Dist: {p.value ?? 25} cm
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Terminal + preview layer (above parts for easy clicking) */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full z-40">
            {/* Uno header terminals */}
            {UNO_TERMINALS.map((t) =>
              renderTerminal(
                t.key,
                unoCoord(t),
                t.label,
                "#cbd5e1",
                (e) => handleTerminalDown(e, t.key),
                `term-${t.key}`,
                undefined,
                false, // Uno SVG graphic already prints D0-D13/PWR labels clearly
              ),
            )}

            {/* Part terminals (with short stub leads into the part body) */}
            {parts.map((p) =>
              PART_LAYOUTS[p.type].terminals.map((t) => {
                const coord = partTerminalCoord(p.id, t.id);
                if (!coord) return null;
                const layout = PART_LAYOUTS[p.type];
                const ex = p.x + layout.el.x;
                const ey = p.y + layout.el.y;
                const target = {
                  x: Math.max(ex, Math.min(coord.x, ex + layout.el.w)),
                  y: Math.max(ey, Math.min(coord.y, ey + layout.el.h)),
                };
                const dx = target.x - coord.x;
                const dy = target.y - coord.y;
                const len = Math.hypot(dx, dy) || 1;
                const stub = {
                  x1: coord.x + (dx / len) * 8,
                  y1: coord.y + (dy / len) * 8,
                  x2: target.x,
                  y2: target.y,
                };
                return renderTerminal(
                  `part-${p.id}-${t.id}`,
                  coord,
                  t.label,
                  "#a5b4fc",
                  (e) => handleTerminalDown(e, `part-${p.id}-${t.id}`),
                  `term-part-${p.label}-${t.id}`,
                  p.type === "breadboard" ? undefined : stub,
                  p.type !== "breadboard",
                );
              }),
            )}

            {/* Live rubber-band preview while routing a wire (in both drawMode and quick-wire) */}
            {pendingKey &&
              cursorPos &&
              (() => {
                const fromEp = keyToEndpoint(pendingKey);
                const from = fromEp ? endpointCoord(fromEp) : null;
                const snapEp = hoverKey && hoverKey !== pendingKey ? keyToEndpoint(hoverKey) : null;
                const to = (snapEp ? endpointCoord(snapEp) : null) ?? cursorPos;
                if (!from) return null;
                return (
                  <g style={{ pointerEvents: "none" }}>
                    <path
                      d={wirePath(from, to)}
                      fill="none"
                      stroke={snapEp ? "#34d399" : drawColor}
                      strokeWidth="3.5"
                      strokeDasharray={snapEp ? "none" : "6 4"}
                      strokeOpacity="0.95"
                      strokeLinecap="round"
                    />
                    <circle cx={from.x} cy={from.y} r={5} fill={drawColor} />
                  </g>
                );
              })()}
          </svg>
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          <strong>Simple wiring:</strong> Click any pin or terminal to start a jumper wire, then
          click another pin to connect. Breadboard holes a–e and f–j share a column; each power rail
          is connected along its length. You can also use <strong>Auto-Wire Task</strong> to connect
          guide wires instantly, or click a wire and press Delete (or the ✕) to remove it. Drag
          components anywhere on the board.
        </span>
      </div>
    </div>
  );
}
