import { test, expect } from "@playwright/test";
import { Pool } from "pg";

// This regression deliberately uses the local IT10 tester: its historical
// deadlines must never be interpreted before its test-account profile loads.
const databaseUrl = process.env["DATABASE_URL"];
const localDatabase =
  databaseUrl && ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname);
const describeLocal = localDatabase ? test.describe : test.describe.skip;

test.use({
  headless: true,
  ...(process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"]
    ? {
        launchOptions: { executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"] },
      }
    : {}),
});

describeLocal("IT10 worksheet startup", () => {
  for (const viewport of [
    { width: 1280, height: 960 },
    { width: 390, height: 844 },
  ]) {
    test(`starts without recording an attempt and includes all four formats (${viewport.width}px)`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      // This suite runs only against an explicitly local database. Normalize
      // the disposable IT10 tester credential so it follows current PIN policy.
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        await pool.query(
          "UPDATE profiles SET pin = '1010', pin_hash = NULL, pin_must_change = false WHERE username = 'it10' OR student_id = 'it10'",
        );
        // Each viewport uses a new browser context; closing the previous fullscreen
        // context can finalize its attempt. Grant this local fixture another try.
        await pool.query(`INSERT INTO quiz_retake_grants(quiz_id,student_id,extra_attempts)
          SELECT q.id,p.id,(SELECT count(*)::integer+1 FROM quiz_attempts a WHERE a.quiz_id=q.id AND a.student_id=p.id)
          FROM quizzes q CROSS JOIN profiles p WHERE q.title='Quiz — Arduino Part 2' AND q.deleted_at IS NULL AND (p.username='it10' OR p.student_id='it10')
          ON CONFLICT(quiz_id,student_id) DO UPDATE SET extra_attempts=greatest(quiz_retake_grants.extra_attempts,EXCLUDED.extra_attempts)`);
      } finally {
        await pool.end();
      }
      await page.setViewportSize(viewport);
      await page.goto("/auth");
      // Authenticate through the same RPC as the login UI. This awaits module
      // hydration explicitly and avoids native pre-hydration form submission.
      await page.evaluate(async () => {
        const modulePath = "/src/lib/lms.ts";
        const lms = await import(modulePath);
        const result = await lms.pinLogin("it10", "1010");
        if (!result.ok) throw new Error("Local IT10 tester login failed");
        lms.saveSession(result.profile);
      });
      const attempts = () =>
        page.evaluate(async () => {
          const modulePath = "/src/lib/lms.ts";
          const lms = await import(modulePath);
          const summaries = await lms.myQuizSummaries();
          return summaries
            .map(
              (row: { quiz_id: string; attempts_used: number }) =>
                `${row.quiz_id}:${row.attempts_used}`,
            )
            .sort();
        });
      const before = await attempts();
      await page.goto("/dashboard/student/courses");
      await page
        .getByRole("button", { name: /Open course IT10 / })
        .first()
        .click();
      const courseUrl = page.url();
      const title = "Quiz — Arduino Part 2";
      const row = page
        .getByTestId("student-worksheet-title")
        .filter({ hasText: title })
        .locator("../..");
      await row.getByRole("button", { name: /Start|Retake/ }).click();
      await page.getByRole("button", { name: "Start worksheet", exact: true }).click();
      await expect(page.getByTestId("question-nav-1")).toBeVisible();
      // Wait through a real countdown tick: the previous bug could briefly
      // render the question before an initialization race submitted it.
      await page.waitForTimeout(1200);
      await expect(page.getByTestId("question-nav-1")).toBeVisible();
      await expect(page.locator('[data-testid^="question-nav-"]')).toHaveCount(20);
      const formats = new Set<string>();
      const dialog = page.getByRole("dialog");
      for (let i = 1; i <= 20; i++) {
        await page.getByTestId(`question-nav-${i}`).click();
        for (const kind of ["Matching", "Essay", "Multiple choice", "Identification"]) {
          if (await dialog.getByText(kind, { exact: true }).count()) formats.add(kind);
        }
      }
      // Enter in an editable answer must add a newline, not submit or navigate.
      let typedAnswer = false;
      let typedCode = false;
      for (let i = 1; i <= 20; i++) {
        await page.getByTestId(`question-nav-${i}`).click();
        const answer = page.getByTestId("answer-input");
        if (await answer.count()) {
          if (!typedAnswer) {
            await answer.pressSequentially("line one");
            await answer.press("Enter");
            await answer.pressSequentially("line two");
            await expect(answer).toHaveValue("line one\nline two");
            typedAnswer = true;
          }
          await expect(page.getByTestId(`question-nav-${i}`)).toBeVisible();
          const editor = page.getByRole("textbox", { name: "Arduino sketch editor" });
          if (await editor.count()) {
            await editor.pressSequentially("void setup() {");
            await editor.press("Enter");
            await editor.pressSequentially("}");
            await expect(editor).toHaveValue("void setup() {\n}");
            typedCode = true;
          }
          if (typedAnswer && typedCode) break;
        }
      }
      expect(typedAnswer).toBe(true);
      expect(typedCode).toBe(true);
      expect([...formats].sort()).toEqual([
        "Essay",
        "Identification",
        "Matching",
        "Multiple choice",
      ]);
      expect(page.url()).toBe(courseUrl);
      // The active fullscreen assessment intentionally has no close button.
      // Leave it open and verify inspection did not create an attempt.
      expect(await attempts()).toEqual(before);
    });
  }
});
