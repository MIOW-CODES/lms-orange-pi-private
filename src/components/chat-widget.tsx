// Floating ClassMate Assistant chat widget — one conversation per profile,
// persisted in this browser (localStorage). Rendered by AppShell for both
// student and staff portals; the server route re-validates the profile and
// scopes tools to its role.
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { GraduationCap, RotateCcw, X, Copy, Check, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from "@/components/ai-elements/tool";
import { useAssessmentMode } from "@/lib/assessment-mode";
import type { Profile } from "@/lib/lms";
import { sessionToken } from "@/lib/lms";
import { WORKSHEET_CHAT_EVENT, type WorksheetAssistContext } from "@/lib/worksheet-context";
import { pasteToWorksheet } from "@/lib/worksheet-context";
import { SOURCE_MATERIAL_MAX_CHARS } from "@/lib/classmate-source";

const TOOL_LABELS: Record<string, string> = {
  list_announcements: "Reading announcements",
  list_courses: "Looking up courses",
  get_my_grades: "Checking your grades",
  list_my_assignments: "Checking activities",
  get_my_attendance: "Checking attendance",
  list_students: "Listing students",
  get_student_grades: "Checking student grades",
  get_student_attendance: "Checking student attendance",
  get_course_performance: "Analyzing class performance",
};

const STUDENT_PROMPTS = [
  "What are my pending activities?",
  "Check my Q1 grades",
  "Summarize the latest announcements",
  "How is my attendance lately?",
];

const STAFF_PROMPTS = [
  "Summarize the latest announcements",
  "How is each course performing this quarter?",
  "Generate a parser-ready worksheet",
  "Draft an essay prompt with a scoring rubric",
];

type AnyPart = UIMessage["parts"][number];

function extractMessageText(m: { parts: AnyPart[] }): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => ("text" in p ? p.text : ""))
    .join("\n");
}

function stripWorksheetPreamble(raw: string): string {
  const lines = raw.split("\n");
  let startIdx = 0;

  // Pass 1: Find "Section I:" as standalone heading (not in table row)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (/^Section\s+I[\s:—–-]+/i.test(trimmed) && !trimmed.startsWith("|")) {
      startIdx = i;
      break;
    }
  }

  // Pass 2: If no Section I found, find first numbered item or first option
  if (startIdx === 0) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (/^\d{1,3}[.)]\s+/.test(trimmed) || /^[A-Z][.)]\s+/.test(trimmed)) {
        startIdx = i;
        break;
      }
    }
  }

  let result = lines.slice(startIdx).join("\n").trim();
  result = result
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/^\|.*\|$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return result;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      const clean = stripWorksheetPreamble(text);
      await navigator.clipboard.writeText(clean);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — try selecting manually");
    }
  };
  return (
    <button
      onClick={handleCopy}
      title="Copy worksheet"
      className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function SendToWorksheetButton({ text }: { text: string }) {
  return (
    <button
      onClick={() => {
        pasteToWorksheet(stripWorksheetPreamble(text));
        toast.success("Pasted into worksheet — review and save");
      }}
      title="Send to worksheet textarea"
      className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
    >
      <FileText className="h-3.5 w-3.5" />
    </button>
  );
}

function isToolPart(part: AnyPart): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function ToolCall({ part }: { part: ToolPart }) {
  const name = part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length);
  const label = TOOL_LABELS[name] ?? name.replaceAll("_", " ");
  return (
    <Tool className="w-full">
      {part.type === "dynamic-tool" ? (
        <ToolHeader type="dynamic-tool" state={part.state} toolName={name} title={label} />
      ) : (
        <ToolHeader type={part.type} state={part.state} title={label} />
      )}
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  );
}

function loadHistory(key: string): UIMessage[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

function ChatPanel({
  profile,
  assistCtx,
  onClose,
}: {
  profile: Profile;
  assistCtx?: WorksheetAssistContext | null;
  onClose: () => void;
}) {
  const storageKey = `miow-chat-${profile.id}`;
  const initialMessages = useMemo(() => loadHistory(storageKey), [storageKey]);
  // Form-to-Chat sync: the active Create Worksheet form's course/title ride
  // along with every request so generation stays scoped to the form.
  const authToken = sessionToken();
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          token: authToken,
          worksheetContext: assistCtx ?? undefined,
        },
      }),
    [authToken, assistCtx],
  );
  const { messages, sendMessage, setMessages, status, error, stop, regenerate } = useChat({
    id: storageKey,
    messages: initialMessages,
    transport,
    onError: (err) => {
      console.error("[chat]", err);
      const msg = err?.message ?? String(err);
      if (msg.includes("401") || msg.includes("Session")) {
        toast.error("Session expired — please sign in again.");
      } else if (msg.includes("502") || msg.includes("AI service")) {
        toast.error("AI service is temporarily unavailable. Please try again in a moment.");
      } else if (msg.includes("network") || msg.includes("fetch")) {
        toast.error("Network error — check your connection and try again.");
      } else {
        toast.error("The assistant hit a problem. Please try again.");
      }
    },
  });

  const panelRef = useRef<HTMLDivElement | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Abort any in-flight generation when the panel unmounts (widget closed).
  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  // Persist the single conversation whenever a run settles.
  useEffect(() => {
    if (status === "ready" || status === "error") {
      try {
        localStorage.setItem(storageKey, JSON.stringify(messages));
      } catch {
        // Storage full or unavailable — the chat still works for the session.
      }
    }
  }, [messages, status, storageKey]);

  // Keep the composer focused once the assistant is done.
  useEffect(() => {
    if (status === "ready") {
      panelRef.current?.querySelector("textarea")?.focus();
    }
  }, [status]);

  // Auto-send message when opened from file upload (e.g. PDF/DOCX source material)
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (assistCtx?.autoMessage && status === "ready" && !autoSentRef.current) {
      autoSentRef.current = true;
      sendMessage({ text: assistCtx.autoMessage });
    }
  }, [assistCtx?.autoMessage, status, sendMessage]);

  const busy = status === "submitted" || status === "streaming";
  // Elapsed timer so long generations show progress instead of a frozen "Thinking…".
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);
  const prompts = profile.role === "student" ? STUDENT_PROMPTS : STAFF_PROMPTS;
  const firstName = profile.full_name.split(" ")[0] ?? profile.full_name;

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text?.trim();
    if (!text || busy) return;
    await sendMessage({ text });
  };

  const newConversation = () => {
    if (busy) return;
    setMessages([]);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  };

  return (
    <div
      ref={panelRef}
      className="flex h-[min(600px,calc(100dvh-8rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lift"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold text-card-foreground">ClassMate Assistant</p>
          <p className="truncate text-xs text-muted-foreground">
            {assistCtx?.course
              ? `Scoped to ${assistCtx.course}${assistCtx.title ? ` · “${assistCtx.title}”` : ""}`
              : profile.role === "student"
                ? "Answers from your own school records"
                : "Class lists, performance & school data"}
          </p>
        </div>
        <button
          onClick={newConversation}
          disabled={busy}
          title="New conversation"
          aria-label="Start a new conversation"
          className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          onClick={onClose}
          title="Close"
          aria-label="Close chat"
          className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Conversation className="flex-1">
        <ConversationContent className="gap-4 p-4">
          {messages.length === 0 && (
            <ConversationEmptyState>
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <GraduationCap className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-display font-bold text-card-foreground">Hi {firstName}!</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ask me about grades, activities, attendance, or announcements.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {prompts.map((p) => (
                    <button
                      key={p}
                      onClick={() => void sendMessage({ text: p })}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </ConversationEmptyState>
          )}

          {messages.map((m) => (
            <Message key={m.id} from={m.role}>
              <MessageContent>
                {m.parts.map((part, i) => {
                  if (part.type === "text") {
                    return <MessageResponse key={i}>{part.text}</MessageResponse>;
                  }
                  if (part.type === "reasoning") {
                    return (
                      <details
                        key={i}
                        className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                      >
                        <summary className="cursor-pointer select-none font-medium">
                          {part.state === "streaming" ? "Thinking…" : "Thought process"}
                        </summary>
                        <p className="mt-1.5 whitespace-pre-wrap">{part.text}</p>
                      </details>
                    );
                  }
                  if (isToolPart(part)) {
                    return <ToolCall key={i} part={part} />;
                  }
                  return null;
                })}
              </MessageContent>
              {m.role === "assistant" && (
                <div className="flex justify-end">
                  <CopyButton text={extractMessageText(m)} />
                  <SendToWorksheetButton text={extractMessageText(m)} />
                </div>
              )}
            </Message>
          ))}

          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer className="text-sm">
                  {elapsed < 3
                    ? "Thinking…"
                    : elapsed < 20
                      ? `Thinking… ${elapsed}s`
                      : `Still working… ${elapsed}s — large worksheets can take up to a minute`}
                </Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          <span>
            {error.message?.includes("502")
              ? "AI service is temporarily unavailable. Please try again in a moment."
              : "The assistant couldn't answer that. Please try again."}
          </span>
          <button
            onClick={() => void regenerate()}
            className="shrink-0 rounded-lg border border-destructive/40 px-2 py-1 font-semibold hover:bg-destructive/10"
          >
            Retry
          </button>
        </div>
      )}

      <div className="border-t border-border p-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            autoFocus
            aria-label="Ask the ClassMate Assistant"
            placeholder={
              profile.role === "student"
                ? "Ask about your grades, tasks…"
                : "Ask about classes, students…"
            }
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} onStop={() => void stop()} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

export function ChatWidget({ profile }: { profile: Profile }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [assistCtx, setAssistCtx] = useState<WorksheetAssistContext | null>(null);
  // Assessment integrity: while a student is actively taking a Worksheet,
  // Assignment, or Exam, the assistant is completely hidden and disabled.
  const assessmentActive = useAssessmentMode();
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (assessmentActive) setOpen(false);
  }, [assessmentActive]);

  // The Create Worksheet form can hand its course/title to the assistant and
  // pop the panel open (form-to-chat state sync).
  useEffect(() => {
    const onAssist = (e: Event) => {
      const detail = (e as CustomEvent<WorksheetAssistContext>).detail;
      if (detail && typeof detail === "object") {
        const ctx: WorksheetAssistContext = {
          course: String(detail.course ?? "").slice(0, 200),
          title: String(detail.title ?? "").slice(0, 200),
        };
        if (typeof detail.sourceMaterial === "string" && detail.sourceMaterial) {
          // Already budgeted by buildSourceMaterial on the sender; keep a hard
          // safety cap so a malformed event can't send an unbounded payload.
          ctx.sourceMaterial = detail.sourceMaterial.slice(0, SOURCE_MATERIAL_MAX_CHARS * 2);
        }
        if (Array.isArray(detail.sourceFileNames) && detail.sourceFileNames.length) {
          ctx.sourceFileNames = detail.sourceFileNames
            .filter((n): n is string => typeof n === "string")
            .slice(0, 50)
            .map((n) => n.slice(0, 200));
        }
        if (Array.isArray(detail.questionTypes) && detail.questionTypes.length) {
          ctx.questionTypes = detail.questionTypes
            .filter((t): t is string => typeof t === "string")
            .slice(0, 8)
            .map((t) => t.slice(0, 40));
        }
        if (typeof detail.autoMessage === "string" && detail.autoMessage) {
          ctx.autoMessage = detail.autoMessage;
        }
        setAssistCtx(ctx);
      }
      setOpen(true);
    };
    window.addEventListener(WORKSHEET_CHAT_EVENT, onAssist);
    return () => window.removeEventListener(WORKSHEET_CHAT_EVENT, onAssist);
  }, []);

  // ClassMate is a staff tool: students never mount the widget. (The API route
  // also rejects student sessions, so this is defense-in-depth.)
  if (assessmentActive || profile.role === "student") return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      <AnimatePresence>
        {open && mounted && (
          <motion.div
            key="chat-panel"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="origin-bottom-right"
          >
            <ChatPanel
              key={profile.id}
              profile={profile}
              assistCtx={assistCtx}
              onClose={() => setOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={() => setOpen((v) => !v)}
        title="ClassMate Assistant"
        aria-label="Open the ClassMate Assistant chat"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lift transition hover:scale-105 active:scale-95"
      >
        {open ? <X className="h-6 w-6" /> : <GraduationCap className="h-6 w-6" />}
      </button>
    </div>
  );
}
