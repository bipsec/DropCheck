"use client";

import * as React from "react";
import { toast } from "sonner";
import { Send, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { streamChat } from "@/lib/api-chat";
import type {
  ChatMessage,
  ToolStep,
} from "@/components/chat-message";
import { ChatMessageView } from "@/components/chat-message";
import { cn } from "@/lib/utils";

/**
 * The single client surface for the Academic Companion. Sends the
 * user's prompt to POST /api/chat, subscribes to the SSE event stream,
 * and accumulates messages in-order. Streaming assistant text extends
 * the current assistant bubble in place; tool_use / tool_result events
 * attach to the assistant bubble as inline "steps" that expand on
 * click.
 */
export function ChatView() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Scroll to bottom on every new message.
  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    setDraft("");
    setBusy(true);

    const userMsg: ChatMessage = {
      kind: "user",
      id: `u-${Date.now()}`,
      text: prompt,
    };
    const assistantId = `a-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      kind: "assistant",
      id: assistantId,
      textBlocks: [],
      toolSteps: [],
      done: false,
    };
    setMessages((cur) => [...cur, userMsg, assistantMsg]);

    try {
      await streamChat({
        prompt,
        onEvent: (ev) => {
          logEvent(ev);
          setMessages((cur) => applyEvent(cur, assistantId, ev));
        },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      toast.error("Chat request failed", { description: detail });
      setMessages((cur) =>
        cur.map((m) =>
          m.kind === "assistant" && m.id === assistantId
            ? { ...m, done: true }
            : m,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div
        ref={listRef}
        className="flex-1 space-y-3 overflow-y-auto px-6 py-6"
      >
        {messages.length === 0 && <EmptyState />}
        {messages.map((m) => (
          <ChatMessageView key={m.id} msg={m} />
        ))}
      </div>
      <div className="border-t border-border/60 bg-background/80 px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Ask about your degree, courses, or dropping a class…"
            className={cn(
              "min-h-[52px] flex-1 resize-none rounded-md border border-border/60 bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground",
              "focus-visible:border-lamp focus-visible:ring-1 focus-visible:ring-lamp",
              busy && "opacity-60",
            )}
            disabled={busy}
          />
          <Button
            variant="lamp"
            size="sm"
            onClick={send}
            disabled={busy || draft.trim().length === 0}
          >
            <Send />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-dashed border-border/60 p-8 text-center">
      <Sparkles className="mx-auto size-6 text-lamp" />
      <h2 className="mt-3 font-display text-lg font-semibold">
        The Academic Companion
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Ask about your program, courses you&apos;ve taken, what to plan next,
        or the impact of dropping something. The advisor remembers what you
        share across the academic year.
      </p>
      <ul className="mx-auto mt-4 max-w-md space-y-1 text-left text-xs text-muted-foreground">
        <li>· &ldquo;I&apos;m a CS major at Purdue, just finished CS 18000.&rdquo;</li>
        <li>· &ldquo;What if I drop CS 25000 this semester?&rdquo;</li>
        <li>· &ldquo;Plan my next four terms with a lighter load.&rdquo;</li>
      </ul>
    </div>
  );
}

// --- Event → state reducer ------------------------------------------------

function applyEvent(
  cur: ChatMessage[],
  assistantId: string,
  ev: Parameters<Parameters<typeof streamChat>[0]["onEvent"]>[0],
): ChatMessage[] {
  return cur.map((m) => {
    if (m.kind !== "assistant" || m.id !== assistantId) return m;

    switch (ev.event) {
      case "assistant_text":
        return { ...m, textBlocks: [...m.textBlocks, ev.data.text] };
      case "tool_use": {
        const step: ToolStep = {
          tool_use_id: ev.data.tool_use_id,
          tool_name: ev.data.tool_name,
          input: ev.data.input,
        };
        return { ...m, toolSteps: [...m.toolSteps, step] };
      }
      case "tool_result": {
        const next = m.toolSteps.map((s) =>
          s.tool_use_id === ev.data.tool_use_id
            ? {
                ...s,
                result: ev.data.content,
                is_error: ev.data.is_error,
              }
            : s,
        );
        return { ...m, toolSteps: next };
      }
      case "run_result":
      case "done":
        return { ...m, done: true };
      case "error": {
        // Represent as an error bubble ALONGSIDE the assistant bubble,
        // but since reduce returns one array we swap the assistant
        // bubble to include a note; the actual error bubble is appended
        // in a post-pass below.
        return { ...m, done: true };
      }
    }
    return m;
  }).concat(
    ev.event === "error"
      ? [
          {
            kind: "error",
            id: `e-${Date.now()}`,
            error: ev.data.error,
            detail: ev.data.detail,
          },
        ]
      : [],
  );
}

/**
 * Mirror every SSE event to the browser console. Tool errors get an
 * explicit `console.error` so a dev inspecting the network / console
 * tab can spot them without expanding each chat step. Tool_use +
 * tool_result at info level so the full call → result pairing shows
 * up chronologically in the console.
 */
function logEvent(ev: Parameters<typeof applyEvent>[2]): void {
  if (typeof window === "undefined") return;
  switch (ev.event) {
    case "tool_use":
      console.info(
        `%c[chat] tool_use %c${ev.data.tool_name}`,
        "color:#888",
        "color:#4c9",
        ev.data.input,
      );
      break;
    case "tool_result":
      if (ev.data.is_error) {
        console.error(
          `%c[chat] tool_error %c${ev.data.tool_use_id}`,
          "color:#c66;font-weight:bold",
          "color:#c66",
          ev.data.content,
        );
      } else {
        console.info(
          `%c[chat] tool_result %c${ev.data.tool_use_id}`,
          "color:#888",
          "color:#4c9",
          ev.data.content,
        );
      }
      break;
    case "run_result":
      console.info("[chat] run_result", ev.data);
      break;
    case "error":
      console.error(
        `%c[chat] stream_error`,
        "color:#c66;font-weight:bold",
        ev.data,
      );
      break;
    // assistant_text / done are noisy — skip.
  }
}
