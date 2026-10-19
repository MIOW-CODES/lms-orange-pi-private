import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Route } from "./chat";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env["OPENCODE_API_KEY"];
let profileSequence = 0;

mock.module("@/lib/server", () => ({
  requireSession: async () => {
    profileSequence++;
    return {
      id: `f90d84d7-9cd5-4e07-85e3-${String(profileSequence).padStart(12, "0")}`,
      role: "teacher",
      full_name: "Test Teacher",
    };
  },
}));
mock.module("@/lib/chat-tools.server", () => ({ systemPromptFor: () => "Test system prompt" }));
mock.module("@/lib/ai-gateway.server", () => ({ AI_BASE_URL: "https://ai.example.test/v1" }));

function postRequest(signal?: AbortSignal): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: "test-session",
      messages: [{ role: "user", parts: [{ type: "text", text: "Hello" }] }],
    }),
    signal,
  });
}

async function post(request: Request): Promise<Response> {
  const handler = Route.options.server?.handlers?.POST;
  if (!handler) throw new Error("Chat POST handler is unavailable");
  return handler({ request } as never);
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    process.env["OPENCODE_API_KEY"] = "test-provider-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env["OPENCODE_API_KEY"];
    else process.env["OPENCODE_API_KEY"] = originalApiKey;
    mock.restore();
  });

  it("returns a generic upstream error and never logs the provider response body", async () => {
    const providerSecret = "provider body containing student-private details";
    globalThis.fetch = mock(async () => new Response(providerSecret, { status: 429 }));
    const log = spyOn(console, "error").mockImplementation(() => {});

    const response = await post(postRequest());
    const output = await response.text();
    const logged = JSON.stringify(log.mock.calls);

    expect(response.status).toBe(502);
    expect(output).toBe("AI service error");
    expect(logged).not.toContain(providerSecret);
  });

  it("converts fetch failures to a generic bounded response", async () => {
    const providerSecret = "network diagnostic with private data";
    globalThis.fetch = mock(async () => {
      throw new Error(providerSecret);
    });
    const log = spyOn(console, "error").mockImplementation(() => {});

    const response = await post(postRequest());
    const output = await response.text();

    expect(response.status).toBe(502);
    expect(output).toBe("AI service is temporarily unavailable");
    expect(JSON.stringify(log.mock.calls)).not.toContain(providerSecret);
  });

  it("bounds streaming errors and exposes no upstream exception details", async () => {
    const providerSecret = "private upstream diagnostic text";
    globalThis.fetch = mock(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error(providerSecret));
            },
          }),
        ),
    );
    const log = spyOn(console, "warn").mockImplementation(() => {});

    const response = await post(postRequest());
    const output = await response.text();

    expect(response.status).toBe(200);
    expect(output).toContain('"type":"error"');
    expect(output).toContain("AI service connection failed");
    expect(output).not.toContain(providerSecret);
    expect(JSON.stringify(log.mock.calls)).not.toContain(providerSecret);
  });

  it("caps model output and cancels upstream work when the client disconnects", async () => {
    const client = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    let upstreamRequest: Record<string, unknown> | undefined;
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamSignal = init?.signal as AbortSignal | undefined;
      upstreamRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const response = await post(postRequest(client.signal));
    expect(response.status).toBe(200);
    expect(upstreamRequest?.["max_tokens"]).toBe(16_384);
    expect(upstreamSignal?.aborted).toBe(false);

    client.abort();
    expect(upstreamSignal?.aborted).toBe(true);
    await response.body?.cancel();
  });
});
