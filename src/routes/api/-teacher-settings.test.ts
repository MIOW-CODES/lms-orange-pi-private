import { describe, expect, it } from "bun:test";
import { Route } from "./teacher/settings";

const MAX_BODY_BYTES = 32 * 1024;

async function patch(request: Request): Promise<Response> {
  const handler = Route.options.server?.handlers?.PATCH;
  if (!handler) throw new Error("Teacher settings PATCH handler is unavailable");
  return handler({ request } as never);
}

describe("PATCH /api/teacher/settings request body", () => {
  it("returns 413 from an oversized declared length before session lookup", async () => {
    const request = new Request("http://localhost/api/teacher/settings", {
      method: "PATCH",
      headers: { "Content-Length": String(MAX_BODY_BYTES + 1) },
      body: "{}",
    });

    const response = await patch(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body too large" });
  });

  it("returns 413 for an oversized streamed body without Content-Length", async () => {
    const body = JSON.stringify({ patch: { bio: "x".repeat(MAX_BODY_BYTES) } });
    const request = new Request("http://localhost/api/teacher/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const response = await patch(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body too large" });
  });

  it("rejects non-object JSON bodies as malformed input", async () => {
    const request = new Request("http://localhost/api/teacher/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });

    const response = await patch(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
  });
});
