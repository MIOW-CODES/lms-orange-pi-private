import { test, expect } from "@playwright/test";
import { Pool } from "pg";
const databaseUrl = process.env["DATABASE_URL"];
const local =
  !!databaseUrl && ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname);
const describeLocal = local ? test.describe : test.describe.skip;
const teacher = "ce800000-0000-4000-8000-000000000001",
  student = "ce800000-0000-4000-8000-000000000002",
  course = "ce800000-0000-4000-8000-000000000003";
test.use({
  headless: true,
  ...(process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"]
    ? { launchOptions: { executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"] } }
    : {}),
});
describeLocal("worksheet-style class record", () => {
  test.beforeAll(async () => {
    const p = new Pool({ connectionString: databaseUrl });
    try {
      await p.query(
        "INSERT INTO profiles(id,email,full_name,role,pin,pin_must_change,student_id,grade_level,section) VALUES ($1,'class-record-teacher@example.test','Class Record Teacher','teacher','6184',false,NULL,NULL,NULL),($2,'class-record-student@example.test','Class Record Student','student','6184',false,'CR-001',10,'Omega') ON CONFLICT(id) DO UPDATE SET pin='6184',pin_hash=NULL,pin_must_change=false,failed_login_attempts=0,locked_until=NULL",
        [teacher, student],
      );
      await p.query(
        "INSERT INTO courses(id,code,title,grade_level,teacher_id,education_level,grading_system) VALUES($1,'CRTEST','Class Record Regression',10,$2,'jhs','k12_quarterly') ON CONFLICT(id) DO NOTHING",
        [course, teacher],
      );
      await p.query(
        "INSERT INTO enrollments(student_id,course_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [student, course],
      );
      await p.query("DELETE FROM class_records WHERE course_id=$1", [course]);
      await p.query("DELETE FROM grades WHERE course_id=$1", [course]);
    } finally {
      await p.end();
    }
  });
  test("edits, saves, blocks incomplete publication, and publishes the exact weighted result", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto("/auth");
    await expect(page.getByRole("tab", { name: /PIN/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeEnabled();
    await page.getByRole("tab", { name: /PIN/ }).click();
    await page
      .getByLabel("Student ID, email, or username")
      .fill("class-record-teacher@example.test");
    await page.getByLabel("PIN or password", { exact: true }).fill("6184");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto("/dashboard/teacher/grades");
    await page.getByLabel("Select course").selectOption(course);
    await expect(page.getByRole("heading", { name: "CRTEST class record" })).toBeVisible();
    await page.getByLabel("Column title", { exact: true }).fill("Q1");
    await page.getByLabel("Maximum", { exact: true }).fill("20");
    await page.getByRole("button", { name: "Add column", exact: true }).click();
    await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("ex");
    await page.getByLabel("Column title", { exact: true }).fill("Exam");
    await page.getByLabel("Maximum", { exact: true }).fill("50");
    await page.getByRole("button", { name: "Add column", exact: true }).click();
    await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("pt");
    await page.getByLabel("Column title", { exact: true }).fill("PT1");
    await page.getByLabel("Maximum", { exact: true }).fill("40");
    await page.getByRole("button", { name: "Add column", exact: true }).click();
    await page.getByLabel("Class Record Student Q1", { exact: true }).fill("16");
    await page.getByLabel("Class Record Student Exam", { exact: true }).fill("40");
    await page.getByLabel("Class Record Student PT1", { exact: true }).fill("36");
    await page.getByLabel("Select Class Record Student", { exact: true }).check();
    await expect(page.getByRole("button", { name: "Publish selected (1)" })).toBeDisabled();
    await page
      .getByLabel("Reason for score / attendance overrides")
      .fill("Verified paper attendance");
    await page.getByLabel("Class Record Student attendance percentage").fill("90");
    await expect(page.getByRole("button", { name: "Publish selected (1)" })).toBeEnabled();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Saved draft · Revision 1", { exact: false })).toBeVisible();
    const p = new Pool({ connectionString: databaseUrl });
    try {
      expect((await p.query("SELECT * FROM grades WHERE course_id=$1", [course])).rowCount).toBe(0);
    } finally {
      await p.end();
    }
    await page.reload();
    await page.getByLabel("Select course").selectOption(course);
    await expect(page.getByLabel("Class Record Student Q1", { exact: true })).toHaveValue("16");
    await page.getByLabel("Select Class Record Student", { exact: true }).check();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Publish selected (1)" }).click();
    await expect(page.getByText("Published 1 student record.", { exact: true })).toBeVisible();
    const p2 = new Pool({ connectionString: databaseUrl });
    try {
      const r = (
        await p2.query("SELECT class_record_snapshot FROM grades WHERE course_id=$1", [course])
      ).rows[0].class_record_snapshot;
      expect(r.initial).toBe(85);
      expect(r.final).toBe(90);
      expect(r.attendance).toBe(90);
    } finally {
      await p2.end();
    }
    for (const [name, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `/tmp/miow-class-record-${name}.png`, fullPage: true });
    }
  });
  test("rejects foreign-roster, incomplete, and stale requests on the server", async ({ page }) => {
    await page.goto("/auth");
    const result = await page.evaluate(
      async ({ course, student }) => {
        const path = "/src/lib/lms.ts";
        const lms = await import(path);
        const r = await lms.pinLogin("class-record-teacher@example.test", "6184");
        if (!r.ok) throw Error("login failed");
        lms.saveSession(r.profile);
        const data = await lms.getClassRecord(course, 2);
        const failures = [];
        for (const [label, patch] of [
          ["incomplete", { publishIds: [student] }],
          ["foreign", { publishIds: ["ce800000-0000-4000-8000-000000000099"] }],
          ["stale", { revision: 99 }],
        ] as const) {
          try {
            await lms.saveClassRecord({
              courseId: course,
              quarter: 2,
              revision: data.revision,
              draft: data.draft,
              publishIds: [],
              ...patch,
            });
          } catch {
            failures.push(label);
          }
        }
        return failures;
      },
      { course, student },
    );
    expect(result).toEqual(["incomplete", "foreign", "stale"]);
  });
});
