/**
 * Seeded lab tasks with ghost wiring guides (Tinkercad-style).
 *
 * Selecting a task places the needed PARTS (unwired) and shows a dashed
 * "ghost" overlay of the expected circuit. Students still place every
 * jumper wire manually — there are never any pre-placed solid wires.
 */
import type { CircuitPartType, WireEndpoint } from "./arduino-simulator";

export interface TaskSeedPart {
  key: string;
  type: CircuitPartType;
  label: string;
  x: number;
  y: number;
  color?: string;
}

export interface TaskGuide {
  from: WireEndpoint;
  to: WireEndpoint;
}

export interface ArduinoTask {
  id: string;
  chip: string;
  title: string;
  hint: string;
  parts: TaskSeedPart[];
  guides: TaskGuide[];
}

const taskTerm = (key: string, terminal: string): WireEndpoint => ({
  kind: "part",
  partId: `task-${key}`,
  terminal,
});
const uno = (pin: number | "5V" | "3V3" | "GND"): WireEndpoint => ({ kind: "uno", pin });

export const ARDUINO_TASKS: ArduinoTask[] = [
  {
    id: "traffic-light",
    chip: "Traffic light",
    title: "Traffic light",
    hint:
      "Connect red to D8, yellow to D9, and green to D10. Connect each LED through its own 220Ω resistor to GND. " +
      "Follow the dashed lines: click one endpoint, then click the other to add a wire.",
    parts: [
      { key: "led-r", type: "wokwi-led", label: "LED1", x: 470, y: 70, color: "red" },
      { key: "led-y", type: "wokwi-led", label: "LED2", x: 610, y: 70, color: "yellow" },
      { key: "led-g", type: "wokwi-led", label: "LED3", x: 750, y: 70, color: "green" },
      { key: "res-r", type: "wokwi-resistor", label: "resistor1", x: 460, y: 250 },
      { key: "res-y", type: "wokwi-resistor", label: "resistor2", x: 600, y: 250 },
      { key: "res-g", type: "wokwi-resistor", label: "resistor3", x: 740, y: 250 },
    ],
    guides: [
      { from: taskTerm("led-r", "A"), to: uno(8) },
      { from: taskTerm("led-r", "K"), to: taskTerm("res-r", "leg1") },
      { from: taskTerm("res-r", "leg2"), to: uno("GND") },
      { from: taskTerm("led-y", "A"), to: uno(9) },
      { from: taskTerm("led-y", "K"), to: taskTerm("res-y", "leg1") },
      { from: taskTerm("res-y", "leg2"), to: uno("GND") },
      { from: taskTerm("led-g", "A"), to: uno(10) },
      { from: taskTerm("led-g", "K"), to: taskTerm("res-g", "leg1") },
      { from: taskTerm("res-g", "leg2"), to: uno("GND") },
    ],
  },
  {
    id: "button-led",
    chip: "Button and LED",
    title: "Button and LED",
    hint:
      "Connect the button to D2 and GND. Connect the LED to D13, then connect it through a 220Ω resistor to GND. " +
      "Follow the dashed lines and click each pair of endpoints to add a wire.",
    parts: [
      { key: "btn", type: "wokwi-pushbutton", label: "button1", x: 470, y: 90, color: "blue" },
      { key: "led", type: "wokwi-led", label: "LED1", x: 660, y: 90, color: "red" },
      { key: "res", type: "wokwi-resistor", label: "resistor1", x: 650, y: 260 },
    ],
    guides: [
      { from: taskTerm("btn", "leg1"), to: uno(2) },
      { from: taskTerm("btn", "leg2"), to: uno("GND") },
      { from: taskTerm("led", "A"), to: uno(13) },
      { from: taskTerm("led", "K"), to: taskTerm("res", "leg1") },
      { from: taskTerm("res", "leg2"), to: uno("GND") },
    ],
  },
];
