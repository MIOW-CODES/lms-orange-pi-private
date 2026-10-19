import { describe, expect, it } from "bun:test";
import {
  ArduinoSimulator,
  buildConnectionsSummary,
  buildNetlist,
  createEmptyBoardState,
  resolveAnalogRead,
  resolveDigitalRead,
  resolvePartStates,
  type CircuitPart,
  type WireSpec,
} from "./arduino-simulator";

describe("ArduinoSimulator", () => {
  it("initializes digital and analog pins correctly", () => {
    const sim = new ArduinoSimulator();
    sim.reset();
    expect(sim.runCode("void setup() {} void loop() {}").success).toBe(true);
    sim.stop();
  });

  it("handles basic LED Blink setup and digitalWrite", () => {
    const sim = new ArduinoSimulator();
    let builtinLedVal = 0;
    sim.setSubscriber((state) => {
      builtinLedVal = state.builtinLed;
    });

    const code = `
      void setup() {
        pinMode(13, OUTPUT);
        digitalWrite(13, HIGH);
      }
      void loop() {
      }
    `;

    const res = sim.runCode(code);
    expect(res.success).toBe(true);
    expect(builtinLedVal).toBe(1);
    sim.stop();
  });

  it("simulates analog inputs and map function", () => {
    const sim = new ArduinoSimulator();
    sim.setAnalogInput(0, 512);

    const recordedVal = 0;
    void recordedVal;
    const code = `
      int sensorValue = 0;
      int mapped = 0;
      void setup() {
        sensorValue = analogRead(A0);
        mapped = map(sensorValue, 0, 1023, 0, 100);
      }
      void loop() {}
    `;

    const res = sim.runCode(code);
    expect(res.success).toBe(true);
    sim.stop();
  });

  it("logs Serial print and println messages", () => {
    const sim = new ArduinoSimulator();
    const logs: string[] = [];
    sim.setSubscriber((_, log) => {
      if (log) logs.push(log);
    });

    const code = `
      void setup() {
        Serial.begin(9600);
        Serial.println("Hello Arduino!");
      }
      void loop() {}
    `;

    const res = sim.runCode(code);
    expect(res.success).toBe(true);
    expect(logs.some((l) => l.includes("Hello Arduino!"))).toBe(true);
    sim.stop();
  });
});

/* ═══════════════════════════════════════════════════════════
 * Manual wiring netlist (Tinkercad-style pin-to-pin jumpers)
 * ═══════════════════════════════════════════════════════════ */

const w = (id: string, from: WireSpec["from"], to: WireSpec["to"]): WireSpec => ({
  id,
  from,
  to,
  color: "#10b981",
});
const uno = (pin: number | "5V" | "3V3" | "GND"): WireSpec["from"] => ({ kind: "uno", pin });
const term = (partId: string, terminal: string): WireSpec["from"] => ({
  kind: "part",
  partId,
  terminal,
});

function boardWithDigital(pin: number, value: 0 | 1, mode: "INPUT" | "OUTPUT" | "INPUT_PULLUP") {
  const board = createEmptyBoardState();
  board.digital[pin]!.mode = mode;
  board.digital[pin]!.digitalValue = value;
  return board;
}

describe("circuit netlist (manual wiring)", () => {
  const led: CircuitPart = { id: "led1", type: "wokwi-led", label: "LED1" };
  const resistor: CircuitPart = { id: "r1", type: "wokwi-resistor", label: "resistor1" };

  it("lights an LED wired pin12→anode, cathode→resistor→GND on digitalWrite(12,HIGH)", () => {
    const wires = [
      w("w1", uno(12), term("led1", "A")),
      w("w2", term("led1", "K"), term("r1", "leg1")),
      w("w3", term("r1", "leg2"), uno("GND")),
    ];
    const board = boardWithDigital(12, 1, "OUTPUT");
    const states = resolvePartStates([led, resistor], wires, board);
    expect(states["led1"]!.lit).toBe(true);
    // resistor is in series — no "missing resistor" warning
    expect(states["led1"]!.warning).toBeNull();
    expect(states["led1"]!.connectedPins).toContain("D12");

    // drive the pin LOW → LED turns off
    const boardLow = boardWithDigital(12, 0, "OUTPUT");
    expect(resolvePartStates([led, resistor], wires, boardLow)["led1"]!.lit).toBe(false);
  });

  it("does NOT light an unwired LED even when pin 13 is driven HIGH", () => {
    const board = boardWithDigital(13, 1, "OUTPUT");
    const states = resolvePartStates([led], [], board);
    expect(states["led1"]!.lit).toBe(false);
    expect(states["led1"]!.connectedPins).toEqual([]);
  });

  it("still lights an LED without a series resistor but raises a warning badge", () => {
    const wires = [w("w1", uno(12), term("led1", "A")), w("w2", term("led1", "K"), uno("GND"))];
    const board = boardWithDigital(12, 1, "OUTPUT");
    const states = resolvePartStates([led], wires, board);
    expect(states["led1"]!.lit).toBe(true);
    expect(states["led1"]!.warning).toMatch(/resistor/i);
  });

  it("reads a pushbutton with INPUT_PULLUP: HIGH released, LOW when pressed to GND", () => {
    const button: CircuitPart = { id: "btn1", type: "wokwi-pushbutton", label: "button1" };
    const wires = [
      w("w1", uno(2), term("btn1", "leg1")),
      w("w2", term("btn1", "leg2"), uno("GND")),
    ];
    const board = boardWithDigital(2, 0, "INPUT_PULLUP");

    // released → pullup keeps the pin HIGH
    expect(resolveDigitalRead(2, [button], wires, board, "INPUT_PULLUP", 0)).toBe(1);
    // pressed → button shorts the pin to GND
    const pressed: CircuitPart = { ...button, pressed: true };
    expect(resolveDigitalRead(2, [pressed], wires, board, "INPUT_PULLUP", 0)).toBe(0);
  });

  it("reads a potentiometer wired SIG→A0 on analogRead(A0)", () => {
    const pot: CircuitPart = {
      id: "pot1",
      type: "wokwi-potentiometer",
      label: "pot1",
      value: 777,
    };
    const wires = [w("w1", term("pot1", "SIG"), uno(14))];
    const board = createEmptyBoardState();
    expect(resolveAnalogRead(0, [pot], wires, board, 0)).toBe(777);
    // unwired pot feeds nothing
    expect(resolveAnalogRead(0, [pot], [], board, 0)).toBe(0);
    // wired to A0 but asking for A1 falls back
    expect(resolveAnalogRead(1, [pot], wires, board, 42)).toBe(42);
  });

  it("routes analogRead through the student's wiring inside the simulator", () => {
    const sim = new ArduinoSimulator();
    const pot: CircuitPart = {
      id: "pot1",
      type: "wokwi-potentiometer",
      label: "pot1",
      value: 777,
    };
    sim.setCircuit([pot], [w("w1", term("pot1", "SIG"), uno(14))]);
    const logs: string[] = [];
    sim.setSubscriber((_, log) => {
      if (log) logs.push(log);
    });
    const res = sim.runCode(`
      void setup() {
        Serial.begin(9600);
        Serial.println(analogRead(A0));
      }
      void loop() {}
    `);
    expect(res.success).toBe(true);
    expect(logs.some((l) => l.includes("777"))).toBe(true);
    sim.stop();
  });

  it("routes digitalRead through a wired pushbutton inside the simulator", () => {
    const sim = new ArduinoSimulator();
    const button: CircuitPart = {
      id: "btn1",
      type: "wokwi-pushbutton",
      label: "button1",
      pressed: true,
    };
    sim.setCircuit(
      [button],
      [w("w1", uno(2), term("btn1", "leg1")), w("w2", term("btn1", "leg2"), uno("GND"))],
    );
    const logs: string[] = [];
    sim.setSubscriber((_, log) => {
      if (log) logs.push(log);
    });
    const res = sim.runCode(`
      void setup() {
        pinMode(2, INPUT_PULLUP);
        Serial.begin(9600);
        Serial.println(digitalRead(2));
      }
      void loop() {}
    `);
    expect(res.success).toBe(true);
    // pressed to GND → LOW (0)
    expect(logs.some((l) => /\b0\b/.test(l))).toBe(true);
    sim.stop();
  });

  it("unions multiple wires on one Uno pin and the shared GND rail into single nets", () => {
    const netlist = buildNetlist(
      [],
      [
        w("w1", uno(8), term("led1", "A")),
        w("w2", uno(8), term("led2", "A")),
        w("w3", term("r1", "leg2"), uno("GND")),
        w("w4", term("r2", "leg2"), uno("GND")),
      ],
    );
    expect(netlist.nodeNet["uno:8"]).toBe(netlist.nodeNet["part:led1:A"]);
    expect(netlist.nodeNet["part:led1:A"]).toBe(netlist.nodeNet["part:led2:A"]);
    expect(netlist.nodeNet["part:r1:leg2"]).toBe(netlist.nodeNet["part:r2:leg2"]);
  });

  it("summarizes wiring in grader-friendly text", () => {
    const parts: CircuitPart[] = [
      { id: "led1", type: "wokwi-led", label: "LED1" },
      { id: "r1", type: "wokwi-resistor", label: "resistor1" },
      { id: "led2", type: "wokwi-led", label: "LED2" },
    ];
    const wires = [
      w("w1", uno(8), term("led1", "A")),
      w("w2", term("led1", "K"), term("r1", "leg1")),
      w("w3", term("r1", "leg2"), uno("GND")),
      w("w4", uno(9), term("led2", "A")),
      w("w5", term("led2", "K"), uno("GND")),
    ];
    const summary = buildConnectionsSummary(parts, wires);
    expect(summary).toContain("LED1 anode → D8");
    expect(summary).toContain("LED1 cathode → resistor1 → GND");
    expect(summary).toContain("LED2 anode → D9");
  });
});

describe("breadboard connectivity", () => {
  const breadboard: CircuitPart = { id: "bb", type: "breadboard", label: "breadboard1" };
  it("joins five-hole strips and continuous rails while isolating the center gap, columns, and rails", () => {
    const { nodeNet: nets } = buildNetlist([breadboard], []);
    const net = (terminal: string) => nets[`part:bb:${terminal}`];
    expect(net("a1")).toBe(net("e1"));
    expect(net("f1")).toBe(net("j1"));
    expect(net("a1")).not.toBe(net("f1"));
    expect(net("a1")).not.toBe(net("a2"));
    expect(net("top+1")).toBe(net("top+30"));
    expect(net("top+1")).not.toBe(net("top-1"));
    expect(net("top+1")).not.toBe(net("bottom+1"));
  });
  it("drives an LED through breadboard strips, a series resistor, and the ground rail", () => {
    const parts: CircuitPart[] = [
      breadboard,
      { id: "led", type: "wokwi-led", label: "LED1" },
      { id: "r", type: "wokwi-resistor", label: "resistor1" },
    ];
    const wires = [
      w("1", uno(8), term("bb", "a1")),
      w("2", term("bb", "e1"), term("led", "A")),
      w("3", term("led", "K"), term("bb", "a2")),
      w("4", term("bb", "e2"), term("r", "leg1")),
      w("5", term("r", "leg2"), term("bb", "top-1")),
      w("6", term("bb", "top-30"), uno("GND")),
    ];
    const states = resolvePartStates(parts, wires, boardWithDigital(8, 1, "OUTPUT"));
    expect(states.led!.lit).toBe(true);
    expect(states.led!.warning).toBeNull();
    expect(resolvePartStates(parts, wires, boardWithDigital(8, 0, "OUTPUT")).led!.lit).toBe(false);
    expect(
      resolvePartStates(parts, wires.slice(0, -1), boardWithDigital(8, 1, "OUTPUT")).led!.lit,
    ).toBe(false);
  });
});
