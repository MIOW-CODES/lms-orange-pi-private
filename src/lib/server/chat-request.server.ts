import { z } from "zod";
import { SOURCE_MATERIAL_MAX_CHARS } from "@/lib/classmate-source";
import { readJsonBody } from "./read-json-body.server";

export const MAX_CHAT_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_CHAT_OUTPUT_TOKENS = 16_384;
export const CHAT_UPSTREAM_TIMEOUT_MS = 120_000;

const MAX_RAW_MESSAGE_CHARS = 200_000;

const ChatPartSchema = z
  .object({
    type: z.string().max(32).optional(),
    text: z.string().max(MAX_RAW_MESSAGE_CHARS).optional(),
  })
  .strip();

const ChatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(MAX_RAW_MESSAGE_CHARS).optional(),
    parts: z.array(ChatPartSchema).max(100).optional(),
  })
  .strip();

const WorksheetContextSchema = z
  .object({
    course: z.string().max(200).optional(),
    title: z.string().max(200).optional(),
    sourceMaterial: z
      .string()
      .max(SOURCE_MATERIAL_MAX_CHARS * 2)
      .optional(),
    sourceFileNames: z.array(z.string().max(200)).max(50).optional(),
    questionTypes: z.array(z.string().max(40)).max(8).optional(),
    autoMessage: z.string().max(2_000).optional(),
  })
  .strip();

const ChatRequestSchema = z
  .object({
    token: z.string().min(1).max(4_096),
    messages: z.array(ChatMessageSchema).max(50),
    worksheetContext: WorksheetContextSchema.optional(),
  })
  .strip();

export type ChatRequestBody = z.infer<typeof ChatRequestSchema>;
export type ChatMessage = ChatRequestBody["messages"][number];

export type ChatRequestParseResult =
  { ok: true; data: ChatRequestBody } | { ok: false; status: 400 | 401 | 413; message: string };

export async function parseChatRequest(request: Request): Promise<ChatRequestParseResult> {
  const body = await readJsonBody(request, MAX_CHAT_REQUEST_BYTES);
  if (!body.ok) {
    if (body.reason === "too_large") {
      return { ok: false, status: 413, message: "Request body too large" };
    }
    return { ok: false, status: 400, message: "Invalid JSON body" };
  }

  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return { ok: false, status: 400, message: "Invalid request body" };
  }
  const raw = body.value as Record<string, unknown>;
  if (!Array.isArray(raw["messages"])) {
    return { ok: false, status: 400, message: "Messages are required" };
  }
  if (raw["messages"].length > 50) {
    return { ok: false, status: 400, message: "Too many messages" };
  }
  if (typeof raw["token"] !== "string" || raw["token"].length === 0) {
    return { ok: false, status: 401, message: "Sign in to chat" };
  }

  const result = ChatRequestSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, status: 400, message: "Invalid chat request" };
  }
  return { ok: true, data: result.data };
}

export function createChatAbortSignal(
  request: Request,
  timeoutMs = CHAT_UPSTREAM_TIMEOUT_MS,
): {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const timeout = AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  const abortForClient = () => controller.abort(request.signal.reason);
  const abortForTimeout = () => controller.abort(timeout.reason);

  if (request.signal.aborted) abortForClient();
  else request.signal.addEventListener("abort", abortForClient, { once: true });
  if (timeout.aborted) abortForTimeout();
  else timeout.addEventListener("abort", abortForTimeout, { once: true });

  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    timedOut: () => timeout.aborted,
    dispose: () => {
      request.signal.removeEventListener("abort", abortForClient);
      timeout.removeEventListener("abort", abortForTimeout);
    },
  };
}
