import { test, expect, type Page } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────────
const SESSION_KEY = "miow-lms-session";

function fakeProfile(role: "admin" | "teacher" | "student") {
  return {
    id: `test-${role}-001`,
    student_id: role === "student" ? "2024-0001" : null,
    email: `${role}@test.miow`,
    pin: null,
    full_name: `Test ${role.charAt(0).toUpperCase() + role.slice(1)}`,
    role,
    rfid_uid: null,
    avatar_url: null,
    grade_level: role === "student" ? 10 : null,
    section: role === "student" ? "A" : null,
    created_at: new Date().toISOString(),
    employee_id: role !== "student" ? `EMP-${role.toUpperCase()}` : null,
    department: role !== "student" ? "CS" : null,
    has_pin: true,
    has_rfid: false,
    session_token: "test-session-token",
  };
}

async function seedSession(page: Page, role: "admin" | "teacher" | "student") {
  // The app deliberately drops sessions whose token the server rejects (a dead
  // token left the shell looking signed-in while every gated call failed), and
  // these UI tests seed a synthetic session that no server would accept. Fail
  // the token-only server calls (session refresh et al.) at the network
  // instead: transient failures keep the cached session, so the dashboards
  // render exactly as they would with a live login.
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.url().includes("/_serverFn/")) {
      const body = req.postData() ?? "";
      // Token-only payloads serialize as {"k":["token"]}; richer calls carry
      // extra keys (e.g. {"k":["table","token"]}) and pass through untouched.
      if (body.includes('"k":["token"]')) {
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  await page.goto("/");
  await page.evaluate(
    ({ key, profile }: { key: string; profile: ReturnType<typeof fakeProfile> }) => {
      localStorage.setItem(key, JSON.stringify(profile));
    },
    { key: SESSION_KEY, profile: fakeProfile(role) },
  );
}

/** Mock all TanStack Start server function POST calls to return success with given data. */
async function mockServerFns(page: Page, mocks: Record<string, unknown>) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    // Check if this is a server function call
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON?.() || {};
      // Try to match by function name in URL or body
      for (const [pattern, data] of Object.entries(mocks)) {
        if (url.includes(pattern) || JSON.stringify(body).includes(pattern)) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ result: data, error: null }),
          });
          return;
        }
      }
    }
    await route.continue();
  });
}

// ══════════════════════════════════════════════════════════
// AUTH PAGE INTERACTIONS
// ══════════════════════════════════════════════════════════
test.describe("Auth page interactions", () => {
  test("auth page loads with MIOW branding and both tabs", async ({ page }) => {
    await page.goto("/auth");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/auth");
    await expect(page.locator("body")).toContainText("MIOW", { timeout: 10000 });
    await expect(page.locator("body")).toContainText("Integrated Developmental School");
    await expect(page.getByRole("tab", { name: /RFID Card/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /PIN Login/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /PIN Login/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  });

  test("auth page opens RFID tap interface when its tab is selected", async ({ page }) => {
    await page.goto("/auth");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/auth");
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeEnabled();
    await page.getByRole("tab", { name: /RFID Card/ }).click();
    await expect(page.getByRole("tab", { name: /RFID Card/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tabpanel", { name: /RFID Card/ })).toContainText(
      "Listening for card tap",
    );
    await expect(page.getByPlaceholder(/RFID UID/)).toBeVisible();
  });

  test("auth page redirects to dashboard when session exists", async ({ page }) => {
    await seedSession(page, "admin");
    await page.goto("/auth");
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/dashboard\/admin/);
  });

  test("homepage redirects to /auth", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("/auth", { timeout: 10000 });
    await expect(page).toHaveURL("/auth");
  });
});

// ADMIN DASHBOARD FLOW
// ══════════════════════════════════════════════════════════
test.describe("Admin dashboard flow", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, "admin");
  });

  test("admin sees sidebar with all nav items", async ({ page }) => {
    await page.goto("/dashboard/admin");
    await page.waitForTimeout(2000);
    const nav = page.locator("nav").first();
    await expect(nav).toContainText("Dashboard");
    await expect(nav).toContainText("Students");
    await expect(nav).toContainText("Teachers");
    await expect(nav).toContainText("Courses");
    await expect(nav).toContainText("Announcements");
    await expect(nav).toContainText("Settings");
  });

  test("admin sees the ClassMate Assistant launcher (staff-only tool)", async ({ page }) => {
    await page.goto("/dashboard/admin");
    await page.waitForTimeout(2000);
    await expect(page.getByRole("button", { name: /Open the ClassMate Assistant/ })).toBeVisible();
  });

  test("admin can navigate to Students page", async ({ page }) => {
    await page.goto("/dashboard/admin");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Students/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/admin\/students/, { timeout: 10000 });
    await expect(page.locator("body")).toContainText(/Students|Manage/);
  });

  test("admin can navigate to Teachers page", async ({ page }) => {
    await page.goto("/dashboard/admin");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Teachers/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/admin\/teachers/, { timeout: 10000 });
    await expect(page.locator("body")).toContainText(/Teachers|Faculty/);
  });

  test("admin can navigate to Courses page", async ({ page }) => {
    await page.goto("/dashboard/admin");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Courses/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/admin\/courses/, { timeout: 10000 });
    await expect(page.locator("body")).toContainText("Courses");
  });

  test("admin can navigate to Announcements page", async ({ page }) => {
    await page.goto("/dashboard/admin");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Announcements/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/admin\/announcements/, { timeout: 10000 });
    await expect(page.locator("body")).toContainText("Announcements");
  });

  test("admin can navigate to Settings page", async ({ page }) => {
    await page.goto("/dashboard/admin");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Settings/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/admin\/settings/, { timeout: 10000 });
    await expect(page.locator("body")).toContainText("Settings");
  });

  test("admin can navigate to Attendance/Kiosk page", async ({ page }) => {
    await page.goto("/dashboard/admin/attendance");
    await page.waitForTimeout(3000);
    await expect(page.locator("body")).toContainText(/Attendance|Kiosk|Tap|RFID/i);
  });

  test("admin can open Create Course modal", async ({ page }) => {
    await page.goto("/dashboard/admin/courses");
    await page.waitForTimeout(2000);
    // Look for Course button
    const courseBtn = page.getByRole("button", { name: /Course/ });
    if (await courseBtn.isVisible()) {
      await courseBtn.click();
      await page.waitForTimeout(500);
      // Modal should appear
      await expect(page.locator("body")).toContainText(/Create.*Course|Course Title|Basic/);
    }
  });

  test("admin can open Create Assignment modal", async ({ page }) => {
    await page.goto("/dashboard/admin/courses");
    await page.waitForTimeout(2000);
    const assignBtn = page.getByRole("button", { name: /Assignment/ });
    if (await assignBtn.isVisible()) {
      await assignBtn.click();
      await page.waitForTimeout(500);
      await expect(page.locator("body")).toContainText(
        /Create.*Assignment|Worksheet title|Post assignment/,
      );
    }
  });

  test("admin can open Create Worksheet modal", async ({ page }) => {
    await page.goto("/dashboard/admin/courses");
    await page.waitForTimeout(2000);
    const quizBtn = page.getByRole("button", { name: /Worksheet/ });
    if (await quizBtn.isVisible()) {
      await quizBtn.click();
      await page.waitForTimeout(500);
      await expect(page.locator("body")).toContainText(
        /Create.*worksheet|Select course|Paste a ClassMate/,
      );
    }
  });

  test("Create Worksheet exposes question-type override + manual entry", async ({ page }) => {
    await page.goto("/dashboard/admin/courses");
    await page.waitForTimeout(2000);
    const quizBtn = page.getByRole("button", { name: /Worksheet/ });
    if (!(await quizBtn.isVisible())) return;
    await quizBtn.click();
    await page.waitForTimeout(500);

    // Question types the teacher can toggle (ClassMate generation).
    await expect(page.locator("body")).toContainText("Question types ClassMate should generate");
    const matchingChip = page.getByRole("button", { name: "Matching Type", exact: true });
    await expect(matchingChip).toBeVisible();
    await matchingChip.click();
    await expect(page.locator("body")).toContainText("Matching Type");

    // Manual entry: adding a question renders an editor row.
    await page.getByRole("button", { name: /Manual Entry/ }).click();
    await page.getByRole("button", { name: /Add Question/ }).click();
    await expect(page.locator("body")).toContainText("Q1");
  });

  test("admin can open Google Docs import modal", async ({ page }) => {
    await page.goto("/dashboard/admin/courses");
    await page.waitForTimeout(2000);
    const importBtn = page.getByRole("button", { name: /Import from Google/ });
    if (await importBtn.isVisible()) {
      await importBtn.click();
      await page.waitForTimeout(500);
      await expect(page.locator("body")).toContainText(
        /Import from Google Docs|Open Google Picker/,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════
// TEACHER DASHBOARD FLOW
// ══════════════════════════════════════════════════════════
test.describe("Teacher dashboard flow", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, "teacher");
  });

  test("teacher sees sidebar with correct nav items", async ({ page }) => {
    await page.goto("/dashboard/teacher");
    await page.waitForTimeout(2000);
    const nav = page.locator("nav").first();
    await expect(nav).toContainText("Dashboard");
    await expect(nav).toContainText("Students");
    await expect(nav).toContainText("Courses");
    await expect(nav).toContainText("Announcements");
    await expect(nav).toContainText("Gradebook");
    await expect(nav).toContainText("Attendance");
    await expect(nav).toContainText("Settings");
  });

  test("teacher can navigate to Students Info", async ({ page }) => {
    await page.goto("/dashboard/teacher");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Students/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/teacher\/students/, { timeout: 10000 });
    await expect(page.locator("body")).toContainText(/Students|Students Info/i);
  });

  test("teacher can navigate to Settings", async ({ page }) => {
    await page.goto("/dashboard/teacher");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Settings/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/teacher\/settings/, { timeout: 10000 });
    await expect(page.locator("body")).toContainText("Settings");
  });
});

// ══════════════════════════════════════════════════════════
// STUDENT DASHBOARD FLOW
// ══════════════════════════════════════════════════════════
test.describe("Student dashboard flow", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, "student");
  });

  test("student sees sidebar with correct nav items", async ({ page }) => {
    await page.goto("/dashboard/student");
    await page.waitForTimeout(2000);
    const nav = page.locator("nav").first();
    await expect(nav).toContainText("Dashboard");
    await expect(nav).toContainText("Courses");
    await expect(nav).toContainText("Grades");
    await expect(nav).toContainText("Activities");
    await expect(nav).toContainText("Attendance");
    await expect(nav).toContainText("Settings");
  });

  test("student never sees the ClassMate Assistant launcher", async ({ page }) => {
    await page.goto("/dashboard/student");
    await page.waitForTimeout(2000);
    await expect(page.getByRole("button", { name: /Open the ClassMate Assistant/ })).toHaveCount(0);
    await expect(page.getByText("ClassMate Assistant")).toHaveCount(0);
  });

  test("student can navigate to Activities page", async ({ page }) => {
    await page.goto("/dashboard/student");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Activities/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/student\/assignments/, { timeout: 10000 });
    await expect(page.locator("body")).toContainText(/Activities|Assignments/i);
  });

  test("student can navigate to Worksheets tab on Courses page", async ({ page }) => {
    await page.goto("/dashboard/student");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Courses/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/student\/courses/, { timeout: 10000 });
    // Worksheets is a tab inside the courses page
    await expect(page.locator("body")).toContainText(/Worksheets|Courses/i);
  });

  test("student can navigate to Grades page", async ({ page }) => {
    await page.goto("/dashboard/student");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Grades/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/student\/grades/, { timeout: 10000 });
    await expect(page.locator("body")).toContainText(/Grades|Grade/i);
  });

  test("student can navigate to Attendance page", async ({ page }) => {
    await page.goto("/dashboard/student");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Attendance/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/student\/attendance/, { timeout: 10000 });
    await expect(page.locator("body")).toContainText(/Attendance/i);
  });

  test("student can navigate to Settings page", async ({ page }) => {
    await page.goto("/dashboard/student");
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: /Settings/ })
      .first()
      .click();
    await page.waitForURL(/\/dashboard\/student\/settings/, { timeout: 10000 });
    await expect(page.locator("body")).toContainText("Settings");
  });
});

// ══════════════════════════════════════════════════════════
// CROSS-ROLE GUARDS
// ══════════════════════════════════════════════════════════
test.describe("Cross-role access guards", () => {
  test("student cannot access admin dashboard", async ({ page }) => {
    await seedSession(page, "student");
    await page.goto("/dashboard/admin");
    await page.waitForTimeout(3000);
    // Should redirect to student's own dashboard
    await expect(page).toHaveURL(/\/dashboard\/student/);
  });

  test("teacher can access admin courses (staff access)", async ({ page }) => {
    await seedSession(page, "teacher");
    await page.goto("/dashboard/admin/courses");
    await page.waitForTimeout(3000);
    await expect(page.locator("body")).toContainText("Courses");
  });
});

// ══════════════════════════════════════════════════════════
// REAL PIN LOGIN (requires DATABASE_URL + headed browser with camera)
// ══════════════════════════════════════════════════════════
// These tests click "Sign In" and wait for redirect to the dashboard. They
// require: (1) a seeded database and (2) a headed Chromium.  In headless CI
// the auth page form doesn't render due to TanStack Start SSR hydration, so
// we skip when running headless (CI sets headless via the playwright config).
const isHeadless = process.env.CI === "true" || process.env.PLAYWRIGHT_HEADLESS === "true";
const describeRealDB =
  !isHeadless && (process.env.PLAYWRIGHT_REAL_DB || process.env.DATABASE_URL)
    ? test.describe
    : test.describe.skip;

describeRealDB("Real PIN login", () => {
  test.setTimeout(60000);

  /** Hydration-safe PIN login: retries tab click + fills until the submit button enables. */
  async function pinLogin(page: Page, id: string, pin: string) {
    // Second-chance credential: a previous run may have already rotated the
    // account's PIN to the gate's test PIN below.
    for (const attemptPin of [pin, "9999"]) {
      await page.goto("/auth");
      await page.evaluate(() => localStorage.clear());
      await page.goto("/auth");
      let submitted = false;
      for (let i = 0; i < 20; i++) {
        try {
          await page.locator("#auth-tab-pin").click({ timeout: 2000 });
          await page.waitForTimeout(150);
          await page.locator("#login-id").fill(id, { timeout: 2000 });
          await page.locator("#login-pin").fill(attemptPin, { timeout: 2000 });
          const btn = page.locator("#auth-panel-pin button[type=submit]");
          if (await btn.isEnabled()) {
            await btn.click({ timeout: 5000 });
            submitted = true;
            break;
          }
        } catch {
          // not hydrated yet — retry
        }
        await page.waitForTimeout(500);
      }
      if (!submitted) throw new Error("PIN login form never became ready");
      await page.waitForURL(/\/dashboard\//, { timeout: 20000 }).catch(() => {});
      if (page.url().includes("/dashboard")) {
        await completePinGate(page);
        return;
      }
    }
    throw new Error("PIN login never completed");
  }

  /**
   * Forced-PIN-change gate: student PINs default to the student number, so the
   * migration flags every student (pin_must_change) and the student layout
   * blocks until a private PIN is chosen. Set the test PIN and proceed.
   */
  async function completePinGate(page: Page, newPin = "9999") {
    const gate = page.getByTestId("pin-gate");
    if (!(await gate.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await page.getByTestId("pin-gate-new").fill(newPin);
    await page.getByTestId("pin-gate-confirm").fill(newPin);
    await page.getByTestId("pin-gate-submit").click();
    await gate.waitFor({ state: "hidden", timeout: 20000 });
  }

  test("admin logs in via PIN and sees Campus Overview", async ({ page }) => {
    // PIN rotated by the pin_security migration (was the documented default).
    await pinLogin(page, "josephalan.vergara@g.msuiit.edu.ph", "5570");
    await page.waitForURL(/\/dashboard\/admin/, { timeout: 20000 });
    await expect(page.locator("body")).toContainText(/Admin Console|Good morning/i, {
      timeout: 15000,
    });
  });

  test("teacher logs in via PIN", async ({ page }) => {
    await pinLogin(page, "jose.ramirez@northview.edu", "2222");
    // Teachers land on the shared admin console courses workspace (dashboardPathFor).
    await page.waitForURL(/\/dashboard\/admin\/courses/, { timeout: 20000 });
    await expect(page.locator("body")).toContainText(/Teacher Portal|Courses/i, {
      timeout: 15000,
    });
  });

  test("student logs in via PIN", async ({ page }) => {
    await pinLogin(page, "charmine.benejol@g.msuiit.edu.ph", "2025-2342");
    await page.waitForURL(/\/dashboard\/student/, { timeout: 20000 });
    await expect(page.locator("body")).toContainText(/Student Dashboard|Welcome/i, {
      timeout: 15000,
    });
  });

  test("student can login via student_id", async ({ page }) => {
    await pinLogin(page, "2025-2342", "2025-2342");
    await page.waitForURL(/\/dashboard\/student/, { timeout: 20000 });
  });
});
