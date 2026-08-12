"use client";

import * as React from "react";
import { Loader2, User, Sparkles, Wrench, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { renderToolResult } from "@/components/tool-render-registry";

/**
 * Client-side message model. The chat view accumulates one `ChatMessage`
 * per user turn and per assistant turn; tool-use and tool-result events
 * attach to the most-recent assistant turn as inline "steps" so the
 * user can see what the agent is doing without waiting for the final
 * text.
 */
export type ChatMessage =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      textBlocks: string[]; // one per assistant_text event
      toolSteps: ToolStep[];
      done: boolean;
    }
  | { kind: "error"; id: string; error: string; detail: string };

export interface ToolStep {
  tool_use_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  // Filled in when the corresponding tool_result event arrives.
  result?: unknown;
  is_error?: boolean;
}

// --- Renderer -------------------------------------------------------------

export function ChatMessageView({ msg }: { msg: ChatMessage }) {
  if (msg.kind === "user") {
    return (
      <Row role="user">
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {msg.text}
        </div>
      </Row>
    );
  }
  if (msg.kind === "error") {
    return (
      <Row role="error">
        <div className="flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 text-[color:var(--color-verdict-significant)]" />
          <div>
            <div className="font-mono text-[11px] text-[color:var(--color-verdict-significant)]">
              {msg.error}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {msg.detail}
            </div>
          </div>
        </div>
      </Row>
    );
  }
  // Assistant
  return (
    <Row role="assistant">
      <div className="space-y-3">
        {!msg.done && <RunningIndicator msg={msg} />}
        {msg.toolSteps.length > 0 && (
          <ul className="space-y-1.5">
            {msg.toolSteps.map((step) => (
              <ToolStepRow key={step.tool_use_id} step={step} />
            ))}
          </ul>
        )}
        {msg.textBlocks.map((t, i) => (
          <AssistantMarkdown key={i} text={t} />
        ))}
      </div>
    </Row>
  );
}

// --- Live activity indicator ---------------------------------------------
// Shows continuously while the assistant is working, so the user isn't
// looking at a static "Thinking…" line for 30 seconds. Three surfaces:
//   1. Header row: pulsing dot + label describing what's happening.
//   2. Elapsed seconds (updates once a second).
//   3. Indeterminate progress bar animation so *something* is moving.

function RunningIndicator({
  msg,
}: {
  msg: Extract<ChatMessage, { kind: "assistant" }>;
}) {
  const [elapsed, setElapsed] = React.useState(0);
  const startRef = React.useRef<number>(Date.now());

  React.useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Currently-running tool (last pending step).
  const runningStep = [...msg.toolSteps].reverse().find(
    (s) => s.result === undefined,
  );
  const label = runningStep
    ? `Running ${prettyToolName(runningStep.tool_name)}…`
    : msg.textBlocks.length > 0
      ? "Composing follow-up…"
      : "Thinking…";

  return (
    <div className="rounded-md border border-lamp/25 bg-lamp/5 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span
            aria-hidden
            className="relative inline-flex size-2.5 items-center justify-center"
          >
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-lamp opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-lamp" />
          </span>
          <span className="text-foreground/80">{label}</span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {elapsed}s
        </span>
      </div>
      <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-lamp/15">
        <div className="chat-progress-bar h-full bg-lamp/70" />
      </div>
    </div>
  );
}

// --- Row wrapper ---------------------------------------------------------

function Row({
  role,
  children,
}: {
  role: "user" | "assistant" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        role === "user"
          ? "border-border/60 bg-muted/40"
          : role === "assistant"
            ? "border-lamp/25 bg-lamp/5"
            : "border-[color:var(--color-verdict-significant)]/30 bg-[color:var(--color-verdict-significant)]/5",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {role === "user" && <User className="size-3" />}
        {role === "assistant" && <Sparkles className="size-3 text-lamp" />}
        {role === "error" && (
          <AlertTriangle className="size-3 text-[color:var(--color-verdict-significant)]" />
        )}
        {role}
      </div>
      {children}
    </div>
  );
}

// --- Tool step ---------------------------------------------------------

function ToolStepRow({ step }: { step: ToolStep }) {
  const [expanded, setExpanded] = React.useState(false);
  const pending = step.result === undefined;
  const errored = step.is_error === true;

  // If we have a registered renderer AND a non-error result, render it
  // inline below the collapsible row so the student sees the chart /
  // course card without clicking anything.
  const inlineViz = !pending
    ? renderToolResult(step.tool_name, step.result, errored)
    : null;

  return (
    <li className="rounded-md border border-border/50 bg-background/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : errored ? (
          <AlertTriangle className="size-3 text-[color:var(--color-verdict-significant)]" />
        ) : (
          <Wrench className="size-3 text-muted-foreground" />
        )}
        <code className="font-mono text-[11px]">{prettyToolName(step.tool_name)}</code>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {pending ? "running" : errored ? "error" : "done"}
        </span>
      </button>
      {inlineViz && <div className="px-3 pb-3">{inlineViz}</div>}
      {expanded && (
        <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
          <div>
            <div className="mb-0.5 font-mono uppercase tracking-wider text-[9px]">
              input
            </div>
            <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-[10px] leading-snug">
              {truncatedJson(step.input)}
            </pre>
          </div>
          {!pending && (
            <div className="mt-2">
              <div className="mb-0.5 font-mono uppercase tracking-wider text-[9px]">
                raw result
              </div>
              <pre
                className={cn(
                  "max-h-60 overflow-auto rounded p-2 font-mono text-[10px] leading-snug",
                  errored
                    ? "bg-[color:var(--color-verdict-significant)]/10 text-[color:var(--color-verdict-significant)]"
                    : "bg-muted/40",
                )}
              >
                {truncatedJson(step.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function prettyToolName(raw: string): string {
  // `mcp__rules-engine__build_track` → `rules · build_track`
  const parts = raw.split("__");
  if (parts.length >= 3 && parts[0] === "mcp") {
    const server = parts[1].replace(/-/g, " ");
    return `${server} · ${parts.slice(2).join("__")}`;
  }
  return raw;
}

function truncatedJson(v: unknown): string {
  try {
    const s = JSON.stringify(v, null, 2);
    return s.length > 2000 ? s.slice(0, 2000) + "\n… (truncated)" : s;
  } catch {
    return String(v);
  }
}
