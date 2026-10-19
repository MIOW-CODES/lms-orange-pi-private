/*
 * Form-to-Chat state sync for the ClassMate Assistant.
 * The Create Worksheet form (admin courses page) publishes the currently
 * selected course + worksheet title here; the chat widget injects them into
 * the request payload so generation stays strictly scoped to the active form.
 */

export interface WorksheetAssistContext {
  /** e.g. "MATH10 — Mathematics 10" */
  course: string;
  /** Worksheet title typed into the form (may be empty). */
  title: string;
  /** Uploaded file content — AI generates questions based on this material. */
  sourceMaterial?: string;
  /** Names of every uploaded source file, so the model can count them exactly. */
  sourceFileNames?: string[];
  /** Question types the teacher wants generated (e.g. ["mc", "fill"]). */
  questionTypes?: string[];
  /** If set, auto-send this message when the chat opens (e.g. from file upload). */
  autoMessage?: string;
}

export const WORKSHEET_CHAT_EVENT = "ids:open-worksheet-chat";

/** Open the chat widget scoped to the active Create Worksheet form. */
export function openWorksheetChat(ctx: WorksheetAssistContext) {
  window.dispatchEvent(
    new CustomEvent<WorksheetAssistContext>(WORKSHEET_CHAT_EVENT, { detail: ctx }),
  );
}

// ── Send-to-worksheet observable ─────────────────────────────────────
// Module-level subscribers list so the chat widget can push text and the
// create-quiz-modal can receive it without worrying about React mount order.

type PasteListener = (text: string) => void;
const listeners: PasteListener[] = [];

/** Subscribe to paste events. Returns an unsubscribe function. */
export function onPasteToWorksheet(fn: PasteListener): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/** Send AI-generated text from the chat to the Create Worksheet textarea. */
export function pasteToWorksheet(text: string) {
  for (const fn of listeners) fn(text);
}
