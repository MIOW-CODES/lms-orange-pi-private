import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { randomInt, randomUUID } from "node:crypto";

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

describeLocal("temporary PIN onboarding for every role", () => {
  for (const role of ["student", "teacher", "admin"] as const) {
    test(`${role} replaces a temporary PIN before accessing the portal`, async ({ page }) => {
      test.setTimeout(90_000);
      const pool = new Pool({ connectionString: databaseUrl });
      const username = `gate-${randomUUID()}`;
      const temporary = String(randomInt(100000, 500000));
      const chosen = String(randomInt(500000, 1000000));
      let profileId: string | undefined;
      try {
        const created = await pool.query<{ id: string; pin_must_change: boolean }>(
          "INSERT INTO profiles(full_name,role,username,pin,pin_hash) VALUES($1,$2,$3,NULL,$4) RETURNING id,pin_must_change",
          ["Temporary onboarding verification", role, username, await bcrypt.hash(temporary, 10)],
        );
        profileId = created.rows[0].id;
        expect(created.rows[0].pin_must_change).toBe(true);
        await page.goto("/auth");
        await page.evaluate(
          async ({ username, temporary }) => {
            const modulePath = "/src/lib/lms.ts";
            const lms = await import(modulePath);
            const result = await lms.pinLogin(username, temporary);
            if (!result.ok || !result.profile.pin_must_change)
              throw new Error("Missing first-login requirement");
            lms.saveSession(result.profile);
          },
          { username, temporary },
        );
        await page.goto(`/dashboard/${role}`);
        await expect(page.getByTestId("pin-gate")).toBeVisible();
        expect(
          await page.evaluate(async () => {
            const modulePath = "/src/lib/lms.ts";
            const lms = await import(modulePath);
            try {
              await lms.listCourses();
              return false;
            } catch (error) {
              return error instanceof Error && error.message.includes("Choose a new PIN");
            }
          }),
        ).toBe(true);
        await page.getByTestId("pin-gate-new").fill(chosen);
        await page.getByTestId("pin-gate-confirm").fill(chosen);
        await page.getByTestId("pin-gate-submit").click();
        await expect(page.getByTestId("pin-gate")).toBeHidden();
        expect(
          await page.evaluate(
            async ({ username, temporary, chosen }) => {
              const modulePath = "/src/lib/lms.ts";
              const lms = await import(modulePath);
              await lms.listCourses();
              const old = await lms.pinLogin(username, temporary);
              const fresh = await lms.pinLogin(username, chosen);
              return !old.ok && fresh.ok && !fresh.profile.pin_must_change;
            },
            { username, temporary, chosen },
          ),
        ).toBe(true);
      } finally {
        if (profileId) {
          await pool.query("DELETE FROM sessions WHERE profile_id=$1", [profileId]);
          await pool.query("DELETE FROM profiles WHERE id=$1", [profileId]);
        }
        await pool.end();
      }
    });
  }
});
