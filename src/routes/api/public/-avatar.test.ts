import { describe, expect, it, mock } from "bun:test";
import { Route } from "./avatar";

const currentPath =
  "f90d84d7-9cd5-4e07-85e3-915100a70a5c/avatar_1770000000000_1234567890abcdef.png";
const legacyPath = "f90d84d7-9cd5-4e07-85e3-915100a70a5c/avatar_1770000000000_1234abcd.png";

let downloadResult: { data: Blob | null; error: { message: string } | null } = {
  data: null,
  error: { message: "not found" },
};
let requireSession: (token: string) => Promise<unknown> = async () => {
  throw new Error("invalid session");
};
const downloadedPaths: string[] = [];

mock.module("@/integrations/db/client.server", () => ({
  storage: {
    from: (bucket: string) => ({
      download: async (path: string) => {
        expect(bucket).toBe("avatars");
        downloadedPaths.push(path);
        return downloadResult;
      },
    }),
  },
}));
mock.module("@/lib/server", () => ({
  requireSession: (token: string) => requireSession(token),
}));

async function get(path: string, authorization?: string): Promise<Response> {
  const handler = Route.options.server?.handlers?.GET;
  if (!handler) throw new Error("Avatar GET handler is unavailable");
  const headers = authorization ? { Authorization: authorization } : undefined;
  return handler({
    request: new Request(`http://localhost/api/public/avatar?p=${encodeURIComponent(path)}`, {
      headers,
    }),
  } as never);
}

describe("GET /api/public/avatar", () => {
  it("rejects legacy 8-hex capability paths before touching storage", async () => {
    downloadedPaths.length = 0;
    const response = await get(legacyPath);
    expect(response.status).toBe(404);
    expect(downloadedPaths).toEqual([]);
  });

  it("serves a current 16-hex avatar path with public cache headers", async () => {
    downloadedPaths.length = 0;
    downloadResult = { data: new Blob(["png"], { type: "image/png" }), error: null };
    const response = await get(currentPath);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(downloadedPaths).toEqual([currentPath]);
    expect(await response.text()).toBe("png");
  });

  it("returns 404 when a previously current avatar file is missing", async () => {
    downloadResult = { data: null, error: { message: "missing" } };
    const response = await get(currentPath);
    expect(response.status).toBe(404);
  });

  it("rejects an invalid optional session token before reading an avatar", async () => {
    downloadedPaths.length = 0;
    requireSession = async () => {
      throw new Error("invalid token");
    };
    const response = await get(currentPath, "Bearer invalid-token");
    expect(response.status).toBe(401);
    expect(downloadedPaths).toEqual([]);
  });
});
