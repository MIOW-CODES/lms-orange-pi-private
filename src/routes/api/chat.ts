// ClassMate Assistant streaming chat endpoint.
// Calls OpenCode Go directly with mimo-v2.5 (bypasses AI SDK streaming for reasoning models).
import { createFileRoute } from "@tanstack/react-router";
import { SOURCE_MATERIAL_MAX_CHARS } from "@/lib/classmate-source";
import {
  createChatAbortSignal,
  MAX_CHAT_OUTPUT_TOKENS,
  parseChatRequest,
  type ChatMessage,
} from "@/lib/server/chat-request.server";

/** Sanitize the optional Create Worksheet form context (course/title/sourceMaterial). */
function parseWorksheetContext(raw: unknown):
  | {
      course?: string;
      title?: string;
      sourceMaterial?: string;
      sourceFileNames?: string[];
      questionTypes?: string[];
    }
  | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const course = typeof o["course"] === "string" ? o["course"].slice(0, 200) : undefined;
  const title = typeof o["title"] === "string" ? o["title"].slice(0, 200) : undefined;
  // The client already budgets the material via buildSourceMaterial; this is a
  // defensive upper bound so a malformed request can't blow up the prompt.
  const sourceMaterial =
    typeof o["sourceMaterial"] === "string"
      ? o["sourceMaterial"].slice(0, SOURCE_MATERIAL_MAX_CHARS * 2)
      : undefined;
  const sourceFileNames = Array.isArray(o["sourceFileNames"])
    ? o["sourceFileNames"]
        .filter((n): n is string => typeof n === "string")
        .slice(0, 50)
        .map((n) => n.slice(0, 200))
    : undefined;
  const questionTypes = Array.isArray(o["questionTypes"])
    ? o["questionTypes"]
        .filter((t): t is string => typeof t === "string")
        .slice(0, 8)
        .map((t) => t.slice(0, 40))
    : undefined;
  if (!course && !title && !sourceMaterial) return undefined;
  const ctx: {
    course?: string;
    title?: string;
    sourceMaterial?: string;
    sourceFileNames?: string[];
    questionTypes?: string[];
  } = {};
  if (course) ctx.course = course;
  if (title) ctx.title = title;
  if (sourceMaterial) ctx.sourceMaterial = sourceMaterial;
  if (sourceFileNames?.length) ctx.sourceFileNames = sourceFileNames;
  if (questionTypes?.length) ctx.questionTypes = questionTypes;
  return ctx;
}

/**
 * Keep prompts small enough to start fast — long source dumps are the main
 * latency driver. Tuned to the mimo-v2.5 context window; revisit if the model
 * (or its max context) changes.
 */
const MAX_MESSAGE_CHARS = 24_000;
const MAX_TOTAL_CHARS = 60_000;

/**
 * Collapse a UI message to plain text, trimming pathological inputs while always
 * preserving the most recent turns.
 */
function toOpenAIMessages(messages: ChatMessage[], systemPrompt: string) {
  const out: Array<{ role: string; content: string }> = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    let text = "";
    if (typeof m.content === "string") text = m.content;
    else if (Array.isArray(m.parts)) {
      text = m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("");
    }
    text = text.trim();
    if (!text) continue;
    if (text.length > MAX_MESSAGE_CHARS) {
      text = `${text.slice(0, MAX_MESSAGE_CHARS)}\n…[truncated ${text.length - MAX_MESSAGE_CHARS} chars]`;
    }
    out.push({ role: m.role, content: text });
  }
  // Drop the oldest turns if the whole prompt is still too large; always keep the last one.
  let total = out.reduce((n, m) => n + m.content.length, 0);
  while (total > MAX_TOTAL_CHARS && out.length > 1) {
    const dropped = out.shift()!;
    total -= dropped.content.length;
  }
  return [{ role: "system", content: systemPrompt }, ...out];
}

const chatRateLimits = new Map<string, number>();
const CHAT_RATE_LIMIT_MS = 10_000; // 10 seconds between requests

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsedRequest = await parseChatRequest(request);
        if (!parsedRequest.ok) {
          return new Response(parsedRequest.message, { status: parsedRequest.status });
        }
        const { messages, token } = parsedRequest.data;

        const apiKey = process.env["OPENCODE_API_KEY"] ?? process.env["AI_GATEWAY_KEY"];
        if (!apiKey) {
          return new Response("Missing OPENCODE_API_KEY", { status: 500 });
        }

        const [{ requireSession }, { systemPromptFor }] = await Promise.all([
          import("@/lib/server"),
          import("@/lib/chat-tools.server"),
        ]);

        let profile;
        try {
          profile = await requireSession(token);
        } catch {
          return new Response("Session expired — please sign in again", { status: 401 });
        }

        // ClassMate Assistant is staff-only. Students must not be able to invoke
        // the assistant even by calling the endpoint directly.
        if (profile.role === "student") {
          return new Response("ClassMate is not available for student accounts", { status: 403 });
        }

        const now = Date.now();
        const lastRequest = chatRateLimits.get(profile.id);
        if (lastRequest && now - lastRequest < CHAT_RATE_LIMIT_MS) {
          return new Response("Too many requests — please wait a moment", { status: 429 });
        }
        chatRateLimits.set(profile.id, now);
        // Evict stale entries every request to prevent unbounded memory growth
        for (const [key, ts] of chatRateLimits) {
          if (now - ts > 60_000) chatRateLimits.delete(key);
        }

        const ctx = parseWorksheetContext(parsedRequest.data.worksheetContext);
        if (ctx?.sourceMaterial) {
          // Observability: make any received-vs-usable mismatch visible in logs
          // instead of letting the model silently under-count uploaded files.
          const usableHeaders = (ctx.sourceMaterial.match(/^--- SOURCE MATERIAL \d+:/gm) ?? [])
            .length;
          const received = ctx.sourceFileNames?.length ?? usableHeaders;
          if (received !== usableHeaders) {
            console.warn(
              `[chat] source material mismatch: received=${received} usable=${usableHeaders}`,
            );
          }
        }
        const oaMessages = toOpenAIMessages(messages, systemPromptFor(profile, ctx));

        const { AI_BASE_URL } = await import("@/lib/ai-gateway.server");
        const sessionId = `miow-${profile.id}-${Date.now()}`;
        const upstreamAbort = createChatAbortSignal(request);
        let apiRes: Response;
        try {
          apiRes = await fetch(`${AI_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "x-opencode-session": sessionId,
            },
            body: JSON.stringify({
              model: "mimo-v2.5",
              messages: oaMessages,
              stream: true,
              max_tokens: MAX_CHAT_OUTPUT_TOKENS,
            }),
            signal: upstreamAbort.signal,
          });
        } catch {
          upstreamAbort.dispose();
          if (upstreamAbort.timedOut()) {
            console.warn("[chat] OpenCode Go request timed out");
            return new Response("AI service timed out", { status: 504 });
          }
          if (request.signal.aborted) return new Response(null, { status: 499 });
          console.error("[chat] OpenCode Go request failed before response");
          return new Response("AI service is temporarily unavailable", { status: 502 });
        }

        if (!apiRes.ok) {
          await apiRes.body?.cancel().catch(() => {});
          upstreamAbort.dispose();
          console.error("[chat] OpenCode Go returned error status", apiRes.status);
          return new Response("AI service error", { status: 502 });
        }
        if (!apiRes.body) {
          upstreamAbort.dispose();
          console.error("[chat] OpenCode Go returned no response stream");
          return new Response("AI service is temporarily unavailable", { status: 502 });
        }

        // Buffer-based SSE parser — handles TCP packet splits correctly
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        let textStarted = false;
        let reasoningStarted = false;
        const textId = `txt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const reasoningId = `rsn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        let buffer = "";

        const sse = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

        const transform = new TransformStream({
          transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true });
            let nlIdx;
            while ((nlIdx = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, nlIdx).trim();
              buffer = buffer.slice(nlIdx + 1);
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") {
                if (reasoningStarted) {
                  controller.enqueue(sse({ type: "reasoning-end", id: reasoningId }));
                }
                if (textStarted) {
                  controller.enqueue(sse({ type: "text-end", id: textId }));
                }
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                continue;
              }
              try {
                const parsed: {
                  choices?: Array<{
                    delta?: { content?: string; reasoning_content?: string; reasoning?: string };
                  }>;
                } = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                if (!delta) continue;

                // Reasoning models stream their chain-of-thought first. Forward it
                // so the UI shows live progress instead of a stalled "Thinking…".
                const reasoning = delta.reasoning_content ?? delta.reasoning;
                if (typeof reasoning === "string" && reasoning.length > 0) {
                  if (!reasoningStarted) {
                    controller.enqueue(sse({ type: "reasoning-start", id: reasoningId }));
                    reasoningStarted = true;
                  }
                  controller.enqueue(
                    sse({ type: "reasoning-delta", id: reasoningId, delta: reasoning }),
                  );
                  continue;
                }

                const content = delta.content;
                if (content === null || content === undefined || content === "") continue;
                if (reasoningStarted) {
                  controller.enqueue(sse({ type: "reasoning-end", id: reasoningId }));
                  reasoningStarted = false;
                }
                if (!textStarted) {
                  controller.enqueue(sse({ type: "text-start", id: textId }));
                  textStarted = true;
                }
                controller.enqueue(sse({ type: "text-delta", id: textId, delta: content }));
              } catch (e) {
                console.error("[chat-api]", e);
              }
            }
          },
        });

        const transformed = apiRes.body.pipeThrough(transform);
        const reader = transformed.getReader();
        let closedOrCancelled = false;
        let upstreamDisposed = false;
        const disposeUpstream = () => {
          if (upstreamDisposed) return;
          upstreamDisposed = true;
          upstreamAbort.dispose();
        };
        const body_ = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (closedOrCancelled) return;
              if (done) {
                closedOrCancelled = true;
                controller.close();
                upstreamAbort.dispose();
              } else {
                controller.enqueue(value);
              }
            } catch {
              if (closedOrCancelled || request.signal.aborted) {
                disposeUpstream();
              } else {
                const message = upstreamAbort.timedOut()
                  ? "AI service timed out. Please try again."
                  : "AI service connection failed. Please try again.";
                controller.enqueue(sse({ type: "error", errorText: message }));
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
                console.warn(
                  "[chat] OpenCode Go stream ended",
                  upstreamAbort.timedOut() ? "after timeout" : "with an upstream error",
                );
                closedOrCancelled = true;
                upstreamAbort.dispose();
              }
            }
          },
          async cancel(reason) {
            closedOrCancelled = true;
            upstreamAbort.abort(reason);
            try {
              await reader.cancel(reason);
            } catch {
              // The upstream may already have errored or been aborted.
            }
            disposeUpstream();
          },
        });
        return new Response(body_, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Vercel-AI-UI-Message-Stream": "v1",
          },
        });
      },
    },
  },
});
