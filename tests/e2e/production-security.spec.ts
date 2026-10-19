import { test, expect } from "@playwright/test";

test.describe("production security smoke checks", () => {
  test("auth page is available with baseline security headers", async ({ page }) => {
    const response = await page.goto("/auth");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response?.headers()["x-frame-options"]).toBe("DENY");
    expect(response?.headers()["strict-transport-security"]).toContain("max-age=63072000");
    expect(response?.headers()["content-security-policy"]).toContain("default-src 'self'");
    await expect(page.locator("body")).toContainText("MIOW");
  });

  test("an unauthenticated browser is redirected away from student pages", async ({ page }) => {
    await page.goto("/dashboard/student");
    await page.waitForURL(/\/auth(?:\?|$)/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/auth(?:\?|$)/);
  });

  test("material path traversal is rejected", async ({ request }) => {
    const response = await request.get("/api/public/material?p=../etc/passwd");
    expect(response.status()).toBe(400);
  });
});
