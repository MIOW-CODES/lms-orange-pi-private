/**
 * Virtual Arduino Simulator Engine
 *
 * Implements a lightweight, browser-side Arduino execution environment:
 * - Digital I/O (Pins 0-13, Built-in LED on Pin 13)
 * - Analog Input (A0-A5 with voltage/slider mapping)
 * - PWM outputs (~3, ~5, ~6, ~9, ~10, ~11)
 * - Serial Monitor communication (Serial.begin, print, println, write)
 * - Time utilities (delay, millis, micros)
 * - Common math & utility helpers (map, constrain, random, min, max, abs)
 * - Tone generation simulation (buzzer on pins)
 */

export interface PinState {
  mode: "INPUT" | "OUTPUT" | "INPUT_PULLUP";
  digitalValue: 0 | 1;
  analogValue: number; // 0-1023 for ADC (inputs), 0-255 for PWM (outputs)
  isPwm?: boolean;
}

export interface ArduinoBoardState {
  digital: Record<number, PinState>;
  analog: Record<number, PinState>; // 0..5
  builtinLed: 0 | 1;
  buzzerTone: number | null; // frequency in Hz or null
  buzzerPin: number | null; // pin the active tone() was emitted on
  millis: number;
}

/* ═══════════════════════════════════════════════════════════════
 * Circuit netlist (Tinkercad-style manual jumper wiring)
 *
 * Students place every jumper wire by hand between real terminals.
 * These pure helpers turn {parts, wires} into electrical nets and
 * resolve what each part should look like / what the sketch reads.
 * All functions are side-effect free and unit-testable.
 * ═══════════════════════════════════════════════════════════════ */

/** Uno header reference: 0-13 digital, 14-19 = A0-A5, plus power rails. */
export type UnoPinRef = number | "5V" | "3V3" | "GND";

export type WireEndpoint =
  { kind: "uno"; pin: UnoPinRef } | { kind: "part"; partId: string; terminal: string };

export interface WireSpec {
  id: string;
  from: WireEndpoint;
  to: WireEndpoint;
  color: string;
}

export type CircuitPartType =
  | "wokwi-led"
  | "wokwi-pushbutton"
  | "wokwi-potentiometer"
  | "wokwi-buzzer"
  | "wokwi-servo"
  | "wokwi-hc-sr04"
  | "wokwi-resistor"
  | "breadboard";

export interface CircuitPart {
  id: string;
  type: CircuitPartType;
  label: string;
  /** potentiometer wiper 0-1023, sonar distance cm, button pressed 0|1 */
  value?: number | undefined;
  /** pushbutton contact state (true = pressed = legs shorted) */
  pressed?: boolean | undefined;
}

export interface PartVisualState {
  /** LED (or on-board indicator) is emitting light */
  lit: boolean;
  /** buzzer is audibly sounding through its wired net */
  sounding: boolean;
  /** servo horn angle in degrees 0-180 */
  angle: number;
  /** non-fatal wiring warning (Tinkercad tolerance — never hard-fails) */
  warning: string | null;
  /** Uno pins directly wired to this part's terminals (derived from wires) */
  connectedPins: string[];
}

export interface CircuitNetlist {
  /** netId for every wired node; nodes absent from the map are unwired */
  nodeNet: Record<string, string>;
  /** every node that belongs to a net */
  netNodes: Record<string, string[]>;
  /** resistor bodies bridging two nets (series elements, never shorts) */
  resistorBridges: Array<{ id: string; label: string; a: string | null; b: string | null }>;
  /** pushbutton contacts bridging two nets while pressed */
  buttonBridges: Array<{ id: string; label: string; a: string | null; b: string | null }>;
}

/** Stable node id for a wire endpoint. */
export function endpointNodeId(e: WireEndpoint): string {
  return e.kind === "uno" ? `uno:${e.pin}` : `part:${e.partId}:${e.terminal}`;
}

/** Human-readable Uno pin name ("D8", "A0", "5V", "3.3V", "GND"). */
export function unoPinName(pin: UnoPinRef): string {
  if (typeof pin === "number") return pin >= 14 ? `A${pin - 14}` : `D${pin}`;
  return pin === "3V3" ? "3.3V" : pin;
}

/** Human-readable part terminal name ("anode", "cathode", "SIG", "+", …). */
export function terminalName(terminal: string): string {
  switch (terminal) {
    case "A":
      return "anode";
    case "K":
      return "cathode";
    case "plus":
      return "+";
    case "minus":
      return "-";
    default:
      return terminal;
  }
}

function partNode(partId: string, terminal: string): string {
  return `part:${partId}:${terminal}`;
}

/** Each five-hole strip shares a net; the center channel and four rails stay isolated. */
export const BREADBOARD_GROUPS: string[][] = [
  ...Array.from({ length: 30 }, (_, i) => ["a", "b", "c", "d", "e"].map((row) => `${row}${i + 1}`)),
  ...Array.from({ length: 30 }, (_, i) => ["f", "g", "h", "i", "j"].map((row) => `${row}${i + 1}`)),
  ...["top+", "top-", "bottom+", "bottom-"].map((rail) =>
    Array.from({ length: 30 }, (_, i) => `${rail}${i + 1}`),
  ),
];

/**
 * Union-find over wire endpoints. Two wires landing on the same Uno pin (or
 * the shared GND rail) collapse into a single net. Part terminals stay
 * separate nodes — components bridge their own terminals (resistor body,
 * pressed button contact), they never short them.
 */
export function buildNetlist(parts: CircuitPart[], wires: WireSpec[]): CircuitNetlist {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    // path compression
    let cur = x;
    while ((parent.get(cur) ?? cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (x: string, y: string) => {
    if (!parent.has(x)) parent.set(x, x);
    if (!parent.has(y)) parent.set(y, y);
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  for (const w of wires) {
    const a = endpointNodeId(w.from);
    const b = endpointNodeId(w.to);
    union(a, b);
  }

  for (const part of parts) {
    if (part.type !== "breadboard") continue;
    for (const group of BREADBOARD_GROUPS) {
      for (const terminal of group.slice(1)) {
        union(partNode(part.id, group[0]!), partNode(part.id, terminal));
      }
    }
  }

  const nodeNet: Record<string, string> = {};
  const netNodes: Record<string, string[]> = {};
  for (const node of parent.keys()) {
    const net = find(node);
    nodeNet[node] = net;
    (netNodes[net] ??= []).push(node);
  }

  const resistorBridges = parts
    .filter((p) => p.type === "wokwi-resistor")
    .map((p) => ({
      id: p.id,
      label: p.label,
      a: nodeNet[partNode(p.id, "leg1")] ?? null,
      b: nodeNet[partNode(p.id, "leg2")] ?? null,
    }));
  const buttonBridges = parts
    .filter((p) => p.type === "wokwi-pushbutton")
    .map((p) => ({
      id: p.id,
      label: p.label,
      a: nodeNet[partNode(p.id, "leg1")] ?? null,
      b: nodeNet[partNode(p.id, "leg2")] ?? null,
    }));

  return { nodeNet, netNodes, resistorBridges, buttonBridges };
}

function netHasUnoPin(netlist: CircuitNetlist, net: string, pin: UnoPinRef): boolean {
  return (netlist.netNodes[net] ?? []).includes(`uno:${pin}`);
}

function netIsDrivenHigh(
  netlist: CircuitNetlist,
  net: string,
  board: ArduinoBoardState | null,
): boolean {
  for (const node of netlist.netNodes[net] ?? []) {
    if (node === "uno:5V" || node === "uno:3V3") return true;
    if (!node.startsWith("uno:")) continue;
    const ref = node.slice(4);
    const pinNum = Number(ref);
    if (!Number.isInteger(pinNum) || !board) continue;
    const pin = board.digital[pinNum];
    if (!pin) continue;
    if (pin.mode === "OUTPUT" && (pin.digitalValue === 1 || pin.analogValue > 127)) return true;
  }
  return false;
}

interface NetEdge {
  to: string;
  viaResistor: boolean;
}

/**
 * Net-to-net adjacency through component bodies: resistors always conduct
 * (series element), pushbutton contacts conduct only while pressed.
 */
function bridgeAdjacency(netlist: CircuitNetlist, parts: CircuitPart[]): Map<string, NetEdge[]> {
  const adj = new Map<string, NetEdge[]>();
  const push = (from: string, to: string, viaResistor: boolean) => {
    if (from === to) return;
    const list = adj.get(from) ?? [];
    list.push({ to, viaResistor });
    adj.set(from, list);
  };
  for (const r of netlist.resistorBridges) {
    if (!r.a || !r.b || r.a === r.b) continue;
    push(r.a, r.b, true);
    push(r.b, r.a, true);
  }
  const pressed = new Set(parts.filter((p) => p.pressed).map((p) => p.id));
  for (const b of netlist.buttonBridges) {
    if (!pressed.has(b.id) || !b.a || !b.b || b.a === b.b) continue;
    push(b.a, b.b, false);
    push(b.b, b.a, false);
  }
  return adj;
}

function findPath(
  startNet: string,
  adj: Map<string, NetEdge[]>,
  isTarget: (net: string) => boolean,
): { found: boolean; viaResistor: boolean } {
  let found = false;
  let viaResistor = false;
  // Track whether each net was reached with / without crossing a resistor so
  // the "missing series resistor" heuristic stays accurate.
  const seenNoR = new Set<string>();
  const seenWithR = new Set<string>();
  const queue: Array<{ net: string; viaResistor: boolean }> = [
    { net: startNet, viaResistor: false },
  ];
  while (queue.length > 0) {
    const { net, viaResistor: via } = queue.shift()!;
    const seen = via ? seenWithR : seenNoR;
    if (seen.has(net)) continue;
    seen.add(net);
    if (isTarget(net)) {
      found = true;
      viaResistor = viaResistor || via;
      if (viaResistor) break;
    }
    for (const edge of adj.get(net) ?? []) {
      queue.push({ net: edge.to, viaResistor: via || edge.viaResistor });
    }
  }
  return { found, viaResistor };
}

function allNetsReachable(startNet: string, adj: Map<string, NetEdge[]>): Set<string> {
  const out = new Set<string>([startNet]);
  const queue = [startNet];
  while (queue.length > 0) {
    const net = queue.shift()!;
    for (const edge of adj.get(net) ?? []) {
      if (!out.has(edge.to)) {
        out.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return out;
}

function netContainsGnd(netlist: CircuitNetlist, net: string): boolean {
  return netHasUnoPin(netlist, net, "GND");
}

function connectedUnoPinNames(netlist: CircuitNetlist, net: string | null | undefined): string[] {
  if (!net) return [];
  const names: string[] = [];
  for (const node of netlist.netNodes[net] ?? []) {
    if (!node.startsWith("uno:")) continue;
    const ref = node.slice(4);
    const asNum = Number(ref);
    const name = unoPinName(Number.isInteger(asNum) ? (asNum as UnoPinRef) : (ref as UnoPinRef));
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Resolve what every part should look like right now (LED lit?, buzzer
 * sounding?, servo angle, wiring warnings). Pure: parts + wires + board.
 */
export function resolvePartStates(
  parts: CircuitPart[],
  wires: WireSpec[],
  board: ArduinoBoardState | null,
): Record<string, PartVisualState> {
  const netlist = buildNetlist(parts, wires);
  const adj = bridgeAdjacency(netlist, parts);
  const states: Record<string, PartVisualState> = {};

  for (const part of parts) {
    const net = (terminal: string) => netlist.nodeNet[partNode(part.id, terminal)] ?? null;
    const connectedPins: string[] = [];

    // Collect derived Uno pins across this part's terminals
    const terminals =
      part.type === "wokwi-led"
        ? ["A", "K"]
        : part.type === "wokwi-pushbutton"
          ? ["leg1", "leg2"]
          : part.type === "wokwi-potentiometer"
            ? ["VCC", "GND", "SIG"]
            : part.type === "wokwi-buzzer"
              ? ["plus", "minus"]
              : part.type === "wokwi-servo"
                ? ["signal", "VCC", "GND"]
                : part.type === "wokwi-hc-sr04"
                  ? ["VCC", "TRIG", "ECHO", "GND"]
                  : ["leg1", "leg2"];
    for (const t of terminals) {
      for (const name of connectedUnoPinNames(netlist, net(t))) {
        if (!connectedPins.includes(name)) connectedPins.push(name);
      }
    }

    let lit = false;
    let sounding = false;
    let angle = 0;
    let msg: string | null = null;

    if (part.type === "wokwi-led") {
      const anode = net("A");
      const cathode = net("K");
      const src = anode
        ? findPath(anode, adj, (n) => netIsDrivenHigh(netlist, n, board))
        : { found: false, viaResistor: false };
      const sink = cathode
        ? findPath(cathode, adj, (n) => netContainsGnd(netlist, n))
        : { found: false, viaResistor: false };
      lit = src.found && sink.found;
      if (lit && !src.viaResistor && !sink.viaResistor) {
        msg = "No series resistor — add a 220Ω resistor to protect the LED";
      } else if (!lit && src.found && !sink.found) {
        msg = "Cathode does not reach GND";
      } else if (!lit && !src.found && sink.found) {
        msg = "Anode is not driven by an output pin";
      }
    } else if (part.type === "wokwi-buzzer") {
      const plus = net("plus");
      const minus = net("minus");
      const tonePin = board?.buzzerPin;
      if (board?.buzzerTone != null && tonePin != null && plus) {
        sounding = findPath(plus, adj, (n) => netHasUnoPin(netlist, n, tonePin)).found;
      }
      if (sounding && minus && !findPath(minus, adj, (n) => netContainsGnd(netlist, n)).found) {
        msg = "Buzzer - terminal does not reach GND";
      }
    } else if (part.type === "wokwi-servo") {
      const signal = net("signal");
      let drivenPin: number | null = null;
      if (signal && board) {
        for (const node of netlist.netNodes[signal] ?? []) {
          if (!node.startsWith("uno:")) continue;
          const pinNum = Number(node.slice(4));
          if (Number.isInteger(pinNum) && board.digital[pinNum]) drivenPin = pinNum;
        }
      }
      if (drivenPin != null && board) {
        const pwm = board.digital[drivenPin]!.analogValue;
        angle = Math.round((Math.max(0, Math.min(255, pwm)) / 255) * 180);
        const vcc = net("VCC");
        const gnd = net("GND");
        const poweredVcc = vcc
          ? findPath(
              vcc,
              adj,
              (n) => netHasUnoPin(netlist, n, "5V") || netHasUnoPin(netlist, n, "3V3"),
            ).found
          : false;
        const poweredGnd = gnd
          ? findPath(gnd, adj, (n) => netContainsGnd(netlist, n)).found
          : false;
        if (!poweredVcc || !poweredGnd) msg = "Servo needs 5V and GND for stable power";
      }
    } else if (part.type === "wokwi-hc-sr04") {
      const vcc = net("VCC");
      const gnd = net("GND");
      const poweredVcc = vcc
        ? findPath(
            vcc,
            adj,
            (n) => netHasUnoPin(netlist, n, "5V") || netHasUnoPin(netlist, n, "3V3"),
          ).found
        : false;
      const poweredGnd = gnd ? findPath(gnd, adj, (n) => netContainsGnd(netlist, n)).found : false;
      if (vcc || gnd) {
        if (!poweredVcc || !poweredGnd) msg = "Sonar needs 5V, GND, TRIG and ECHO wired";
      }
    }

    states[part.id] = {
      lit,
      sounding,
      angle,
      warning: msg,
      connectedPins,
    };
  }

  return states;
}

/**
 * digitalRead(n) through the student's wiring: a pressed pushbutton bridges
 * its legs, INPUT_PULLUP defaults HIGH, and a bridge to GND wins over the
 * pullup (Tinkercad behaviour).
 */
export function resolveDigitalRead(
  pin: number,
  parts: CircuitPart[],
  wires: WireSpec[],
  board: ArduinoBoardState | null,
  mode: "INPUT" | "OUTPUT" | "INPUT_PULLUP",
  fallback: 0 | 1,
): 0 | 1 {
  const netlist = buildNetlist(parts, wires);
  const startNet = netlist.nodeNet[`uno:${pin}`];
  if (!startNet) return fallback;
  const adj = bridgeAdjacency(netlist, parts);
  const reach = allNetsReachable(startNet, adj);
  for (const net of reach) {
    if (netContainsGnd(netlist, net)) return 0;
  }
  for (const net of reach) {
    if (netHasUnoPin(netlist, net, "5V") || netHasUnoPin(netlist, net, "3V3")) return 1;
  }
  if (mode === "INPUT_PULLUP") return 1;
  return fallback;
}

/**
 * analogRead(a) through the student's wiring: a potentiometer wiper (SIG)
 * wired to that analog pin feeds its slider value; otherwise fall back to the
 * board's analog input (PCB-view sliders).
 */
export function resolveAnalogRead(
  analogIndex: number,
  parts: CircuitPart[],
  wires: WireSpec[],
  board: ArduinoBoardState | null,
  fallback: number,
): number {
  const netlist = buildNetlist(parts, wires);
  for (const part of parts) {
    if (part.type !== "wokwi-potentiometer") continue;
    const sig = netlist.nodeNet[partNode(part.id, "SIG")];
    if (!sig) continue;
    if (netHasUnoPin(netlist, sig, 14 + analogIndex)) {
      return Math.max(0, Math.min(1023, Math.round(part.value ?? 0)));
    }
  }
  return fallback;
}

/** Display name for a wire endpoint, e.g. "LED1 anode" / "D8" / "GND". */
export function endpointDisplayName(e: WireEndpoint, parts: CircuitPart[]): string {
  if (e.kind === "uno") return unoPinName(e.pin);
  const part = parts.find((p) => p.id === e.partId);
  const label = part?.label ?? e.partId;
  return `${label} ${terminalName(e.terminal)}`;
}

/**
 * Auto-generated plain-text description of the student's wiring, e.g.
 * "LED1 anode → D8, LED1 cathode → resistor1 → GND". Tailored so the
 * existing keyword grader (pins, GND, resistor terms) can score it.
 */
export function buildConnectionsSummary(parts: CircuitPart[], wires: WireSpec[]): string {
  const nameOf = (e: WireEndpoint) => endpointDisplayName(e, parts);
  // Reads naturally as "LED1 anode → D8": part terminals first, Uno pins last.
  const ordered = (a: WireEndpoint, b: WireEndpoint): [WireEndpoint, WireEndpoint] =>
    a.kind === "uno" && b.kind === "part" ? [b, a] : [a, b];
  const clauses: string[] = [];
  const consumedWireIds = new Set<string>();

  for (const part of parts) {
    if (part.type !== "wokwi-resistor") continue;
    const side = (terminal: string) =>
      wires.filter(
        (w) =>
          (w.from.kind === "part" && w.from.partId === part.id && w.from.terminal === terminal) ||
          (w.to.kind === "part" && w.to.partId === part.id && w.to.terminal === terminal),
      );
    const other = (w: WireSpec, terminal: string): WireEndpoint =>
      w.from.kind === "part" && w.from.partId === part.id && w.from.terminal === terminal
        ? w.to
        : w.from;
    const s1 = side("leg1");
    const s2 = side("leg2");
    for (const w of [...s1, ...s2]) consumedWireIds.add(w.id);
    const n1 = s1.map((w) => other(w, "leg1"));
    const n2 = s2.map((w) => other(w, "leg2"));
    if (n1.length > 0 && n2.length > 0) {
      for (const a of n1) {
        for (const b of n2) {
          // Part terminal → resistor → Uno pin reads best; keep leg order otherwise.
          const [first, last] = a.kind === "uno" && b.kind === "part" ? [b, a] : [a, b];
          clauses.push(`${nameOf(first)} → ${part.label} → ${nameOf(last)}`);
        }
      }
    } else {
      for (const a of n1) clauses.push(`${nameOf(a)} → ${part.label}`);
      for (const b of n2) clauses.push(`${nameOf(b)} → ${part.label}`);
    }
  }

  for (const w of wires) {
    if (consumedWireIds.has(w.id)) continue;
    const [first, last] = ordered(w.from, w.to);
    clauses.push(`${nameOf(first)} → ${nameOf(last)}`);
    if (clauses.length >= 32) break;
  }

  return clauses.join(", ");
}

export interface SimulatorExecutionResult {
  outputLogs: string[];
  boardState: ArduinoBoardState;
  error?: string;
}

/** Fresh board state for canvas-side resolution helpers. */
export function createEmptyBoardState(): ArduinoBoardState {
  const digital: Record<number, PinState> = {};
  for (let i = 0; i <= 13; i++) {
    digital[i] = {
      mode: "INPUT",
      digitalValue: 0,
      analogValue: 0,
      isPwm: [3, 5, 6, 9, 10, 11].includes(i),
    };
  }
  const analog: Record<number, PinState> = {};
  for (let i = 0; i <= 5; i++) {
    analog[i] = { mode: "INPUT", digitalValue: 0, analogValue: 0 };
  }
  return { digital, analog, builtinLed: 0, buzzerTone: null, buzzerPin: null, millis: 0 };
}

export class ArduinoSimulator {
  private board: ArduinoBoardState;
  private circuit: { parts: CircuitPart[]; wires: WireSpec[] } | null = null;
  private logs: string[] = [];
  private isRunning = false;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private tickIntervalMs = 50;
  private speedFactor = 1.0;
  private startTime = 0;
  private simulatedMillis = 0;
  private onStateChange?: (state: ArduinoBoardState, log?: string) => void;

  constructor() {
    this.board = this.createInitialBoardState();
  }

  private createInitialBoardState(): ArduinoBoardState {
    return createEmptyBoardState();
  }

  /**
   * Attach the student's manual wiring (Tinkercad-style netlist). digitalRead /
   * analogRead resolve through these wires; parts with no wire stay idle.
   */
  public setCircuit(parts: CircuitPart[], wires: WireSpec[]) {
    this.circuit = { parts, wires };
    this.emitChange();
  }

  public reset() {
    this.stop();
    this.board = this.createInitialBoardState();
    this.logs = [];
    this.simulatedMillis = 0;
    this.emitChange();
  }

  public setAnalogInput(pinIndex: number, value0to1023: number) {
    if (this.board.analog[pinIndex]) {
      this.board.analog[pinIndex].analogValue = Math.max(
        0,
        Math.min(1023, Math.round(value0to1023)),
      );
      this.board.analog[pinIndex].digitalValue = value0to1023 > 512 ? 1 : 0;
      this.emitChange();
    }
  }

  public setDigitalInput(pinNumber: number, value: 0 | 1) {
    if (this.board.digital[pinNumber]) {
      this.board.digital[pinNumber].digitalValue = value;
      this.emitChange();
    }
  }

  public setSubscriber(fn: (state: ArduinoBoardState, newLog?: string) => void) {
    this.onStateChange = fn;
  }

  private emitChange(newLog?: string) {
    if (this.onStateChange) {
      this.onStateChange({ ...this.board }, newLog);
    }
  }

  public parseAndCompile(cCode: string): {
    setupCode: string;
    loopCode: string;
    globalCode: string;
  } {
    const clean = cCode.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    const setupMatch = clean.match(/void\s+setup\s*\(\s*\)\s*\{([\s\S]*?)\}/);
    const loopMatch = clean.match(/void\s+loop\s*\(\s*\)\s*\{([\s\S]*?)\}/);

    const setupBody = setupMatch && setupMatch[1] ? setupMatch[1] : "";
    const loopBody = loopMatch && loopMatch[1] ? loopMatch[1] : "";

    const globals = clean
      .replace(/void\s+setup\s*\(\s*\)\s*\{[\s\S]*?\}/, "")
      .replace(/void\s+loop\s*\(\s*\)\s*\{[\s\S]*?\}/, "");

    return {
      setupCode: setupBody,
      loopCode: loopBody,
      globalCode: globals,
    };
  }

  /**
   * Transforms Arduino C++ syntax into browser-executable JavaScript
   */
  public transpileToJS(rawCode: string): string {
    let js = rawCode;

    // Convert type declarations
    js = js.replace(
      /\b(int|float|double|long|unsigned\s+long|byte|char|bool|boolean|void|String|const\s+\w+)\s+([a-zA-Z0-9_]+)\b/g,
      "let $2",
    );

    // Convert boolean keywords
    js = js.replace(/\bHIGH\b/g, "1");
    js = js.replace(/\bLOW\b/g, "0");
    js = js.replace(/\bOUTPUT\b/g, "'OUTPUT'");
    js = js.replace(/\bINPUT_PULLUP\b/g, "'INPUT_PULLUP'");
    js = js.replace(/\bINPUT\b/g, "'INPUT'");
    js = js.replace(/\bLED_BUILTIN\b/g, "13");

    // Convert Analog pin literals A0..A5
    js = js.replace(/\bA0\b/g, "14");
    js = js.replace(/\bA1\b/g, "15");
    js = js.replace(/\bA2\b/g, "16");
    js = js.replace(/\bA3\b/g, "17");
    js = js.replace(/\bA4\b/g, "18");
    js = js.replace(/\bA5\b/g, "19");

    return js;
  }

  public runCode(code: string): { success: boolean; error?: string } {
    this.reset();
    try {
      const { setupCode, loopCode, globalCode } = this.parseAndCompile(code);
      const transpiledGlobals = this.transpileToJS(globalCode);
      const transpiledSetup = this.transpileToJS(setupCode);
      const transpiledLoop = this.transpileToJS(loopCode);

      const sandboxEnv = this.createRuntimeSandbox();

      const runnerCode = `
        ${transpiledGlobals}

        function setup() {
          ${transpiledSetup}
        }

        function loop() {
          ${transpiledLoop}
        }

        return { setup, loop };
      `;

      const fn = new Function(
        "pinMode",
        "digitalWrite",
        "digitalRead",
        "analogRead",
        "analogWrite",
        "tone",
        "noTone",
        "delay",
        "millis",
        "micros",
        "map",
        "constrain",
        "min",
        "max",
        "abs",
        "random",
        "Serial",
        runnerCode,
      );

      const userProgram = fn(
        sandboxEnv.pinMode,
        sandboxEnv.digitalWrite,
        sandboxEnv.digitalRead,
        sandboxEnv.analogRead,
        sandboxEnv.analogWrite,
        sandboxEnv.tone,
        sandboxEnv.noTone,
        sandboxEnv.delay,
        sandboxEnv.millis,
        sandboxEnv.micros,
        sandboxEnv.map,
        sandboxEnv.constrain,
        sandboxEnv.min,
        sandboxEnv.max,
        sandboxEnv.abs,
        sandboxEnv.random,
        sandboxEnv.Serial,
      );

      this.isRunning = true;
      this.startTime = Date.now();

      // Run setup
      if (typeof userProgram.setup === "function") {
        userProgram.setup();
        this.emitChange();
      }

      // Start loop loop timer
      this.timerId = setInterval(() => {
        if (!this.isRunning) return;
        try {
          this.simulatedMillis += Math.round(this.tickIntervalMs * this.speedFactor);
          this.board.millis = this.simulatedMillis;
          if (typeof userProgram.loop === "function") {
            userProgram.loop();
          }
          this.emitChange();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.stop();
          this.log(`Runtime Error in loop: ${msg}`);
          this.emitChange(`[Error] ${msg}`);
        }
      }, this.tickIntervalMs);

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.stop();
      this.log(`Compile Error: ${msg}`);
      return { success: false, error: msg };
    }
  }

  public stop() {
    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.board.buzzerTone = null;
    this.board.buzzerPin = null;
    this.emitChange();
  }

  public getLogs(): string[] {
    return [...this.logs];
  }

  private log(message: string) {
    this.logs.push(message);
    if (this.logs.length > 500) this.logs.shift();
    this.emitChange(message);
  }

  private createRuntimeSandbox() {
    const board = this.board;
    const log = this.log.bind(this);

    const pinMode = (pin: number, mode: "INPUT" | "OUTPUT" | "INPUT_PULLUP") => {
      const pinNum = Number(pin);
      if (pinNum >= 0 && pinNum <= 13 && board.digital[pinNum]) {
        board.digital[pinNum]!.mode = mode;
      }
    };

    const digitalWrite = (pin: number, val: 0 | 1 | boolean | number) => {
      const pinNum = Number(pin);
      const v: 0 | 1 = val ? 1 : 0;
      if (pinNum >= 0 && pinNum <= 13 && board.digital[pinNum]) {
        board.digital[pinNum]!.digitalValue = v;
        if (pinNum === 13) {
          board.builtinLed = v;
        }
      }
    };

    const digitalRead = (pin: number): number => {
      const pinNum = Number(pin);
      let fallback: 0 | 1 = 0;
      let mode: "INPUT" | "OUTPUT" | "INPUT_PULLUP" = "INPUT";
      if (pinNum >= 0 && pinNum <= 13 && board.digital[pinNum]) {
        fallback = board.digital[pinNum]!.digitalValue;
        mode = board.digital[pinNum]!.mode;
      } else if (pinNum >= 14 && pinNum <= 19 && board.analog[pinNum - 14]) {
        fallback = board.analog[pinNum - 14]!.digitalValue;
      }
      if (this.circuit) {
        return resolveDigitalRead(
          pinNum,
          this.circuit.parts,
          this.circuit.wires,
          board,
          mode,
          fallback,
        );
      }
      return fallback;
    };

    const analogRead = (pin: number): number => {
      const pinNum = Number(pin);
      const aPin = pinNum >= 14 ? pinNum - 14 : pinNum;
      if (aPin >= 0 && aPin <= 5 && board.analog[aPin]) {
        const fallback = board.analog[aPin]!.analogValue;
        if (this.circuit) {
          return resolveAnalogRead(aPin, this.circuit.parts, this.circuit.wires, board, fallback);
        }
        return fallback;
      }
      return 0;
    };

    const analogWrite = (pin: number, val: number) => {
      const pinNum = Number(pin);
      const clamped = Math.max(0, Math.min(255, Math.round(Number(val))));
      if (pinNum >= 0 && pinNum <= 13 && board.digital[pinNum]) {
        board.digital[pinNum]!.analogValue = clamped;
        board.digital[pinNum]!.digitalValue = clamped > 127 ? 1 : 0;
        if (pinNum === 13) {
          board.builtinLed = clamped > 127 ? 1 : 0;
        }
      }
    };

    const tone = (pin: number, freq: number) => {
      board.buzzerTone = Math.max(20, Math.min(20000, Number(freq)));
      board.buzzerPin = Number(pin);
    };

    const noTone = () => {
      board.buzzerTone = null;
      board.buzzerPin = null;
    };

    const delay = (_ms: number) => {
      // In browser cooperative tick loop, delay steps time forward simulated
      this.simulatedMillis += Math.round(Number(_ms) || 0);
    };

    const millis = () => this.simulatedMillis;
    const micros = () => this.simulatedMillis * 1000;

    const map = (x: number, in_min: number, in_max: number, out_min: number, out_max: number) => {
      return ((x - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
    };

    const constrain = (amt: number, low: number, high: number) =>
      Math.max(low, Math.min(high, amt));

    const Serial = {
      begin: (baud: number) => {
        log(`[Serial opened at ${baud} baud]`);
      },
      print: (val: unknown) => {
        log(String(val));
      },
      println: (val: unknown = "") => {
        log(String(val) + "\n");
      },
      write: (val: unknown) => {
        log(String(val));
      },
    };

    return {
      pinMode,
      digitalWrite,
      digitalRead,
      analogRead,
      analogWrite,
      tone,
      noTone,
      delay,
      millis,
      micros,
      map,
      constrain,
      min: Math.min,
      max: Math.max,
      abs: Math.abs,
      random: (minOrMax: number, maxVal?: number) => {
        if (maxVal === undefined) return Math.floor(Math.random() * minOrMax);
        return Math.floor(Math.random() * (maxVal - minOrMax) + minOrMax);
      },
      Serial,
    };
  }
}
