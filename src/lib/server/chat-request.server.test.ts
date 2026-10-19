import { describe, expect, it } from "bun:test";
import {
  CHAT_UPSTREAM_TIMEOUT_MS,
  MAX_CHAT_OUTPUT_TOKENS,
  MAX_CHAT_REQUEST_BYTES,
  createChatAbortSignal,
  parseChatRequest,
} from "./chat-request.server";

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("parseChatRequest", () => {
  it("accepts bounded UI messages and worksheet context", async () => {
    const result = await parseChatRequest(
      request({
        token: "cookie-session",
        messages: [
          { id: "m1", role: "user", parts: [{ type: "text", text: "Help me." }] },
          { id: "m2", role: "assistant", content: "Sure." },
        ],
        worksheetContext: {
          course: "MATH10 — Mathematics 10",
          title: "Linear equations",
          sourceMaterial: "Example source",
          sourceFileNames: ["lesson.pdf"],
          questionTypes: ["mc", "fill"],
          autoMessage: "Generate a worksheet.",
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("returns 413 for declared or streamed bodies over the byte limit", async () => {
    const declared = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Length": String(MAX_CHAT_REQUEST_BYTES + 1) },
      body: "{}",
    });
    expect(await parseChatRequest(declared)).toEqual({
      ok: false,
      status: 413,
      message: "Request body too large",
    });

    const streamed = new Request("http://localhost/api/chat", {
      method: "POST",
      body: " ".repeat(MAX_CHAT_REQUEST_BYTES + 1),
    });
    expect(await parseChatRequest(streamed)).toEqual({
      ok: false,
      status: 413,
      message: "Request body too large",
    });
  });

  it("keeps the existing missing-message and authentication responses", async () => {
    expect(await parseChatRequest(request({ token: "t" }))).toEqual({
      ok: false,
      status: 400,
      message: "Messages are required",
    });
    expect(await parseChatRequest(request({ token: "t", messages: [] }))).toEqual({
      ok: true,
      data: { token: "t", messages: [] },
    });
    expect(await parseChatRequest(request({ messages: [] }))).toEqual({
      ok: false,
      status: 401,
      message: "Sign in to chat",
    });
  });

  it("rejects too many messages and malformed or oversized fields", async () => {
    expect(
      await parseChatRequest(
        request({ token: "t", messages: Array.from({ length: 51 }, () => ({})) }),
      ),
    ).toEqual({ ok: false, status: 400, message: "Too many messages" });
    expect(await parseChatRequest(request({ token: "t", messages: [{ role: "system" }] }))).toEqual(
      {
        ok: false,
        status: 400,
        message: "Invalid chat request",
      },
    );
    expect(
      await parseChatRequest(
        request({
          token: "t",
          messages: [],
          worksheetContext: { sourceFileNames: Array.from({ length: 51 }, () => "file.pdf") },
        }),
      ),
    ).toEqual({ ok: false, status: 400, message: "Invalid chat request" });
  });
});

describe("createChatAbortSignal", () => {
  it("propagates a client disconnect", () => {
    const client = new AbortController();
    const incoming = new Request("http://localhost/api/chat", { signal: client.signal });
    const upstream = createChatAbortSignal(incoming);
    client.abort();
    expect(upstream.signal.aborted).toBe(true);
    expect(upstream.timedOut()).toBe(false);
  });

  it("aborts stalled upstream work after the configured timeout", async () => {
    const incoming = new Request("http://localhost/api/chat");
    const upstream = createChatAbortSignal(incoming, 5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(upstream.signal.aborted).toBe(true);
    expect(upstream.timedOut()).toBe(true);
    expect(CHAT_UPSTREAM_TIMEOUT_MS).toBe(120_000);
  });
});

it("caps generated tokens at the product maximum", () => {
  expect(MAX_CHAT_OUTPUT_TOKENS).toBe(16_384);
});
