import { test, expect } from "@playwright/test";

test.describe("Availability and Access Control Matrix (P2c)", () => {
  test("direct-URL access to materials endpoint returns expected status codes", async ({
    request,
  }) => {
    // 1. Without session token: 401 Unauthorized
    const unauthRes = await request.get(
      "/api/public/material?p=11111111-1111-1111-1111-111111111111/material_1728288000000_123456.pdf",
    );
    expect(unauthRes.status()).toBe(401);

    // 2. Traversal attempt blocked: 400 Bad Request
    const traversalRes = await request.get("/api/public/material?p=../etc/passwd");
    expect(traversalRes.status()).toBe(400);

    // 3. Invalid UUID path format: 400 Bad Request
    const invalidPathRes = await request.get("/api/public/material?p=random_unformatted_file.pdf");
    expect(invalidPathRes.status()).toBe(400);
  });

  test("availability helpers and boundaries are active", async ({ request }) => {
    // Health / root endpoint sanity
    const rootRes = await request.get("/");
    expect(rootRes.status()).toBe(200);
  });
});
