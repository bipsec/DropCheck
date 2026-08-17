// The SSE wire contract between `POST /api/chat` and the browser.
//
// Lifted out of the web app's `api-chat.ts` when the API split off onto
// its own origin. It lives here because it is the one thing both sides
// must agree on: the API's `toSseEvents()` emits these shapes and the
// browser's parser consumes them. Sharing the definition means a change
// to either side fails typecheck instead of failing silently at runtime
// in a student's browser.

export type ChatEventName =
  | "assistant_text"
  | "tool_use"
  | "tool_result"
  | "run_result"
  | "error"
  | "done";

export interface ChatEvent<T = unknown> {
  event: ChatEventName;
  data: T;
}

export interface AssistantTextEvent extends ChatEvent<{ text: string }> {
  event: "assistant_text";
}

export interface ToolUseEvent
  extends ChatEvent<{
    tool_use_id: string;
    tool_name: string;
    input: Record<string, unknown>;
  }> {
  event: "tool_use";
}

export interface ToolResultEvent
  extends ChatEvent<{
    tool_use_id: string;
    is_error: boolean;
    content: unknown;
  }> {
  event: "tool_result";
}

export interface RunResultEvent
  extends ChatEvent<{
    subtype?: string;
    is_error?: boolean;
    num_turns?: number;
  }> {
  event: "run_result";
}

export interface ErrorEvent
  extends ChatEvent<{ error: string; detail: string }> {
  event: "error";
}

export interface DoneEvent extends ChatEvent<{ session_id?: string | null }> {
  event: "done";
}

export type ChatStreamEvent =
  | AssistantTextEvent
  | ToolUseEvent
  | ToolResultEvent
  | RunResultEvent
  | ErrorEvent
  | DoneEvent;

// --- Session bootstrap (`POST /api/session`) -------------------------------

export interface SessionResponse {
  student_id: string | null;
  session_id: string;
  no_db: boolean;
}
