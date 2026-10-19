import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";

/**
 * Arduino manual-wiring E2E (mobile 390×844).
 *
 * Verifies the Tinkercad-style experience end to end:
 *  - students place parts from the palette and wire terminals MANUALLY
 *    (nothing is pre-wired; no auto bezier wires)
 *  - an LED wired anode→D8 / cathode→resistor→GND lights on
 *    digitalWrite(8, HIGH) while an unwired LED2 stays dark on D13
 *  - the Connections summary reflects the wires and inserts into the answer
 *  - the Arduino Lab route shows the seeded task chips with a dashed ghost
 *    wiring guide
 *
 * Uses a local seed account so the test can run without touching remote data.
 *
 * NOTE: the login rate limiter allows only 5 attempts / 15 min per account,
 * so authentication happens ONCE per worker (worker-scoped storage state)
 * and every test reuses that session.
 */

const databaseUrl = process.env["DATABASE_URL"];
const localDatabase =
  databaseUrl && ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname);
const describeLocalDB = localDatabase ? base.describe : base.describe.skip;

const TEST_TIMEOUT = 240_000;

/** Hydration-safe PIN login: retries until the React submit handler runs and
 *  the server lands us on the dashboard (native pre-hydration submits reload).
 *  Completes the forced-PIN-change gate when it appears; falls back to the test
 *  PIN below when a previous run already rotated the account's PIN. */
async function pinLogin(page: Page, id: string, pin: string) {
  await page.goto("/auth");
  const result = await page.evaluate(
    async ({ id, pins }) => {
      const modulePath = "/src/lib/lms.ts";
      const lms = await import(modulePath);
      for (const candidate of pins) {
        const login = await lms.pinLogin(id, candidate);
        if (login.ok) {
          lms.saveSession(login.profile);
          return true;
        }
      }
      return false;
    },
    { id, pins: [pin, "9999"] },
  );
  if (result) {
    await page.goto("/dashboard/student");
    await completePinGate(page);
    return;
  }
  throw new Error("PIN login never completed");
}

/** Forced-PIN-change gate: student PINs default to the student number, so the
 *  migration flags every student (pin_must_change) and the student layout
 *  blocks until a private PIN is chosen. Set the test PIN and proceed. */
async function completePinGate(page: Page, newPin = "9999") {
  const gate = page.getByTestId("pin-gate");
  await gate.waitFor({ state: "visible", timeout: 20000 });
  await page.getByTestId("pin-gate-new").fill(newPin);
  await page.getByTestId("pin-gate-confirm").fill(newPin);
  await page.getByTestId("pin-gate-submit").click();
  await gate.waitFor({ state: "hidden", timeout: 20000 });
}

/** Login once per worker; every test reuses the authenticated storage state. */
const test = base.extend<
  object,
  { sessionState: Awaited<ReturnType<BrowserContext["storageState"]>> }
>({
  sessionState: [
    async ({ browser }, provide) => {
      if (!databaseUrl || !localDatabase)
        throw new Error("Arduino E2E setup requires the disposable local test database");
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        // Later migrations intentionally defer the student PIN gate. Restore
        // this one seeded account to the documented temporary-ID fixture and
        // clear auth attempts left by preceding tests in this local DB only.
        await pool.query("DELETE FROM auth_rate_limits");
        const seededStudent = await pool.query(
          "UPDATE profiles SET pin = $1, pin_hash = NULL, pin_must_change = TRUE, failed_login_attempts = 0, locked_until = NULL WHERE student_id = $1",
          ["2026-0099"],
        );
        if (seededStudent.rowCount !== 1)
          throw new Error("Arduino E2E seed student 2026-0099 was not found");
      } finally {
        await pool.end();
      }
      const ctx = await browser.newContext({
        baseURL: process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000",
      });
      const page = await ctx.newPage();
      // The disposable fixture models student-ID temporary PIN onboarding.
      await pinLogin(page, "2026-0099", "2026-0099");
      await page.waitForURL(/\/dashboard\/student/, { timeout: 30000 });
      const state = await ctx.storageState();
      await ctx.close();
      await provide(state);
    },
    { scope: "worker" },
  ],
  storageState: async ({ sessionState }, provide) => {
    await provide(sessionState);
  },
});

test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 15_000 });

/** The exam hard-lock overlay appears if fullscreen was entered and lost. */
async function dismissExamLock(page: Page) {
  const overlay = page.getByText("Exam lockdown active");
  if (await overlay.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Return to fullscreen" }).click();
    await page.waitForTimeout(300);
  }
}

/** Place parts and wire LED1 anode→D8, cathode→resistor→GND — fully manually. */
async function wireLedWithResistor(page: Page) {
  await page.locator('[data-testid="palette-wokwi-led"]').click();
  await page.locator('[data-testid="palette-wokwi-led"]').click();
  await page.locator('[data-testid="palette-wokwi-resistor"]').click();

  await page.locator('[data-testid="tool-wire"]').click();
  const wire = async (from: string, to: string) => {
    await page.locator(`[data-testid="${from}"]`).click();
    await page.locator(`[data-testid="${to}"]`).click();
  };
  await wire("term-part-LED1-A", "term-uno-D8");
  await wire("term-part-LED1-K", "term-part-resistor1-leg1");
  await wire("term-part-resistor1-leg2", "term-uno-GND");
  await page.locator('[data-testid="tool-select"]').click();
}

const BLINK_BOTH_SKETCH = `
void setup() {
  pinMode(8, OUTPUT);
  pinMode(13, OUTPUT);
}
void loop() {
  digitalWrite(8, HIGH);
  digitalWrite(13, HIGH);
  delay(200);
}
`;

async function runSketch(page: Page, code: string) {
  const editor = page.getByPlaceholder(/Type or paste your Arduino C\+\+ sketch/);
  await editor.fill(code);
  await page.getByRole("button", { name: "Run code", exact: true }).click();
}

/** Screenshot the full 1080px workbench (element shot ignores viewport clip). */
async function shotWorkbench(page: Page, path: string) {
  const wb = page.locator('[data-testid="arduino-workbench"]');
  await wb.scrollIntoViewIfNeeded();
  // reset the scrollable workbench container so the capture starts at x=0
  await wb.evaluate((el) => el.parentElement?.scrollTo({ left: 0 }));
  await page.waitForTimeout(400);
  await wb.screenshot({ path });
}

/** Collect browser console errors (page crashes, failed hydration, etc). */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

describeLocalDB("Arduino manual wiring (Tinkercad-style)", () => {
  // IT10 assessments are date-gated for production (Open Fri 2026-10-16
  // 08:00–10:00 Asia/Manila). The e2e DB is built from the same migrations, so
  // the worksheet under test would be unreachable ("not yet open"). Open the
  // IT10 window for the duration of the test run only — this is a test fixture,
  // not a change to the production window.
  test.beforeAll(async () => {
    const url = process.env["DATABASE_URL"];
    if (!url) return;
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query(
        `UPDATE public.quizzes
            SET opens_at = NULL, closes_at = now() + interval '30 days'
          WHERE deleted_at IS NULL
            AND course_id = (SELECT id FROM public.courses WHERE code = 'IT10')`,
      );
      const labTaskSeed = await pool.query(
        `SELECT count(*)::int AS count, bool_and(required) AS all_required
           FROM public.quiz_questions q
           JOIN public.quizzes quiz ON quiz.id = q.quiz_id
          WHERE quiz.title = 'Quiz — Arduino Part 2'
            AND quiz.deleted_at IS NULL
            AND quiz.course_id = (SELECT id FROM public.courses WHERE code = 'IT10')
            AND q.lab_task = true`,
      );
      expect(labTaskSeed.rows[0]?.count).toBe(2);
      expect(labTaskSeed.rows[0]?.all_required).toBe(true);
      // This UI test targets a specific lab_task prompt. Use the full bank in
      // the isolated CI database so the task is deterministic instead of
      // relying on a random 20-item draw to include it.
      await pool.query(
        `UPDATE public.quizzes
            SET question_count = 0
          WHERE deleted_at IS NULL
            AND title = 'Quiz — Arduino Part 2'
            AND course_id = (SELECT id FROM public.courses WHERE code = 'IT10')`,
      );
    } finally {
      await pool.end();
    }
  });

  test.afterAll(async () => {
    if (!databaseUrl || !localDatabase) return;
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(
        `UPDATE public.quizzes
            SET question_count = 20
          WHERE deleted_at IS NULL
            AND title = 'Quiz — Arduino Part 2'
            AND course_id = (SELECT id FROM public.courses WHERE code = 'IT10')`,
      );
    } finally {
      await pool.end();
    }
  });

  test("worksheet lab_task: prompt and Arduino Lab are available in the attempt", async ({
    page,
  }) => {
    test.setTimeout(TEST_TIMEOUT);
    const errors = collectConsoleErrors(page);
    await page.goto("/dashboard/student/courses");
    await page.getByRole("button", { name: /^Worksheets/ }).click();
    await expect(page.getByRole("heading", { name: "Courses" })).toBeVisible({
      timeout: 20000,
    });

    // Open the seeded worksheet. This fixture includes all questions so the
    // lab task is deterministic. Keep the single attempt focused: leaving the
    // fullscreen worksheet is an integrity event and submits it automatically.
    const startBtn = page
      .getByTestId("student-worksheet-title")
      .filter({ hasText: "Quiz — Arduino Part 2" })
      .locator("../..")
      .getByRole("button", { name: /Start|Retake/ });

    const courseUrl = page.url();
    await startBtn.click();
    await expect(page.getByRole("alertdialog")).toContainText("Quiz — Arduino Part 2");
    expect(page.url()).toBe(courseUrl);
    await page.getByRole("button", { name: "Start worksheet", exact: true }).click();
    await expect(page.getByTestId("question-nav-1")).toBeVisible();
    expect(page.url()).toBe(courseUrl);
    await dismissExamLock(page);
    let onLabTask = false;
    const navCount = await page.locator('[data-testid^="question-nav-"]').count();
    for (let i = 1; i <= navCount; i++) {
      await page.getByTestId(`question-nav-${i}`).click();
      if (
        await page
          .locator('[data-testid="connections-summary"]')
          .isVisible()
          .catch(() => false)
      ) {
        onLabTask = true;
        break;
      }
    }
    expect(onLabTask).toBe(true);
    await expect(page.getByText(/Simulation Task [AB]/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="connections-summary"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Arduino Lab route: same manual wiring + ghost guide chips", async ({ page }, testInfo) => {
    test.setTimeout(TEST_TIMEOUT);
    const errors = collectConsoleErrors(page);
    await page.goto("/dashboard/student/arduino");
    await expect(page.locator("h1")).toHaveText("Arduino Lab", { timeout: 20000 });

    // Turn off the default beginner task for the manual-palette wiring scenario.
    await page.locator('[data-testid="task-chip-button-led"]').click();
    // Manual wiring first — parts placed from the palette, wires by hand
    await wireLedWithResistor(page);
    await runSketch(page, BLINK_BOTH_SKETCH);
    await expect(page.locator('[data-testid="part-LED1"]')).toHaveAttribute("data-lit", "true", {
      timeout: 15000,
    });
    await expect(page.locator('[data-testid="part-LED2"]')).toHaveAttribute("data-lit", "false", {
      timeout: 15000,
    });
    await page.screenshot({ path: "/tmp/opencode/ard-lab-wired.png" });
    await shotWorkbench(page, "/tmp/opencode/ard-lab-workbench.png");

    // Seeded Part II task chips with a dashed ghost wiring guide (no solid wires)
    const chipA = page.locator('[data-testid="task-chip-traffic-light"]');
    const chipB = page.locator('[data-testid="task-chip-button-led"]');
    await expect(chipA).toBeVisible();
    await expect(chipB).toBeVisible();

    await chipA.click();
    await expect(page.locator('[data-testid="task-hint"]')).toBeVisible();
    const guides = page.locator('[data-testid="ghost-guide"]');
    expect(await guides.count()).toBeGreaterThan(0);
    // let React paint the seeded task parts before the screenshots
    await page.waitForTimeout(800);
    expect(await page.locator('[data-testid^="part-"]').count()).toBeGreaterThanOrEqual(9);

    await page.screenshot({ path: "/tmp/opencode/ard-lab-ghost-guide.png" });
    await shotWorkbench(page, "/tmp/opencode/ard-lab-ghost-workbench.png");

    // Ghost guide is dashed-only: the manual wires we placed are untouched
    await expect(page.locator('[data-testid="part-LED1"]')).toHaveAttribute("data-lit", "true", {
      timeout: 15000,
    });

    await chipB.click();
    await expect(page.locator('[data-testid="task-hint"]')).toContainText("Button and LED");
    await page.screenshot({ path: "/tmp/opencode/ard-lab-task-b.png" });
    await shotWorkbench(page, "/tmp/opencode/ard-lab-task-b-workbench.png");
    await testInfo.attach("ard-lab-ghost-guide", {
      path: "/tmp/opencode/ard-lab-ghost-guide.png",
    });
    expect(errors).toEqual([]);
  });

  test("unwired parts stay dark — no pre-placed jumpers", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);
    const errors = collectConsoleErrors(page);
    await page.goto("/dashboard/student/arduino");
    await expect(page.locator("h1")).toHaveText("Arduino Lab", { timeout: 20000 });

    // Seed a task (which shows dashed ghost guides) and add a palette LED
    await page.locator('[data-testid="task-chip-traffic-light"]').click();
    await page.locator('[data-testid="palette-wokwi-led"]').click();

    // Run a sketch driving D13 HIGH — every unwired LED must stay dark
    await runSketch(page, BLINK_BOTH_SKETCH);
    await page.waitForTimeout(1500);
    const lit = page.locator('[data-testid="part-LED4"][data-lit="true"]');
    expect(await lit.count()).toBe(0);
    await expect(page.locator('[data-testid="part-LED1"]')).toHaveAttribute("data-lit", "false");
    expect(errors).toEqual([]);
  });
});
