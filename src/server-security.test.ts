import { afterAll, expect, it } from "bun:test";

const previousDatabaseUrl = process.env["DATABASE_URL"];
if (!previousDatabaseUrl) {
  process.env["DATABASE_URL"] = "postgres://test:test@127.0.0.1:5432/test";
}
const { applySecurityHeaders } = await import("../src/server");
if (!previousDatabaseUrl) delete process.env["DATABASE_URL"];

afterAll(() => {
  if (previousDatabaseUrl) process.env["DATABASE_URL"] = previousDatabaseUrl;
  else delete process.env["DATABASE_URL"];
});

it("prevents browser caching of server-rendered HTML", () => {
  const response = applySecurityHeaders(
    new Response("<html>private dashboard</html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
    "akios.site",
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=86400");
});

it("preserves explicit cache policy for non-HTML responses", () => {
  const response = applySecurityHeaders(
    new Response("{}", {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      },
    }),
    "localhost:3000",
  );
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
  expect(response.headers.get("Strict-Transport-Security")).toBeNull();
});

it("does not apply the apex HSTS policy to other akios.site subdomains", () => {
  const response = applySecurityHeaders(
    new Response("<html></html>", {
      headers: { "Content-Type": "text/html" },
    }),
    "www.akios.site",
  );
  expect(response.headers.get("Strict-Transport-Security")).toBeNull();
});

it("does not grant content-security-policy access to external analytics", () => {
  const response = applySecurityHeaders(
    new Response("<html></html>", {
      headers: { "Content-Type": "text/html" },
    }),
    "akios.site",
  );
  const policy = response.headers.get("Content-Security-Policy") ?? "";
  expect(policy).not.toContain("vercel-scripts");
  expect(policy).not.toContain("vercel-insights");
  expect(policy).not.toContain("pulse.joalvergs.tech");
});
