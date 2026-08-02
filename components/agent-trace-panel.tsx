"use client";

import * as React from "react";
import {
  Loader2,
  CheckCircle2,
  CircleDashed,
  AlertCircle,
  MinusCircle,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { LampSignature } from "@/components/lamp-signature";
import type { TraceEvent } from "@/lib/api-types";
import { cn } from "@/lib/utils";

type Props = {
  trace: TraceEvent[] | null;
  running: boolean;
};

// The pipeline for a first-turn query fires this set. Follow-ups override.
const DEFAULT_PIPELINE = [
  "router",
  "context",
  "intake",
  "academic",
  "financial",
  "status",
  "synthesis",
] as const;

// Rough per-step budgets (ms) observed in the smoke logs. Used only to
// pace the *pending* shell so it visibly advances while the server
// response is still in flight — the real trace overwrites this once it
// lands. Values are conservative; overshooting is fine because the last
// step just keeps spinning.
const EXPECTED_MS: Record<string, number> = {
  router: 1000,
  context: 1500,
  intake: 10000,
  academic: 15000,
  financial: 16000,
  status: 200, // usually short-circuits on non-international
  synthesis: 22000,
  clarification: 6000,
};

const AGENT_LABEL: Record<string, string> = {
  router: "Reading your question",
  context: "Loading your profile + catalog",
  intake: "Restating the decision",
  academic: "Checking academic impact",
  financial: "Checking financial-aid impact",
  status: "Checking enrollment status",
  synthesis: "Merging the reports",
  clarification: "Answering your follow-up",
  graph: "Running the pipeline",
};

/**
 * Live-ish agent trace panel.
 *
 * The transport is still a single POST that returns after the full
 * pipeline completes (see plan/DropCheck.md — SSE was deferred). To keep
 * the panel from feeling frozen for ~60s we:
 *
 *   1. While `running` and no trace has landed: render a shell of the
 *      expected pipeline and auto-advance the "currently working" cursor
 *      forward using rough per-step budgets from EXPECTED_MS. Previous
 *      steps flip to a dim checkmark so it *looks* sequential.
 *   2. When the real trace lands: reveal its steps proportionally to
 *      each step's real duration_ms (capped) so slow steps feel slow.
 */
export function AgentTracePanel({ trace, running }: Props) {
  const compressed = React.useMemo(() => compress(trace ?? []), [trace]);
  const [pendingIndex, setPendingIndex] = React.useState(0);
  const [revealCount, setRevealCount] = React.useState(0);

  // Auto-advance the pending shell while we're waiting for the server.
  React.useEffect(() => {
    if (!running || compressed.length > 0) return;
    setPendingIndex(0);
    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      const agent = DEFAULT_PIPELINE[i];
      const budget = EXPECTED_MS[agent] ?? 8000;
      const timer = setTimeout(() => {
        if (cancelled) return;
        i = Math.min(i + 1, DEFAULT_PIPELINE.length - 1);
        setPendingIndex(i);
        if (i < DEFAULT_PIPELINE.length - 1) tick();
      }, budget);
      return () => clearTimeout(timer);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [running, compressed.length]);

  // When the real trace lands, reveal each step after a delay
  // proportional to its recorded duration (capped so long agents don't
  // freeze the reveal).
  React.useEffect(() => {
    if (!compressed.length) {
      setRevealCount(0);
      return;
    }
    let cancelled = false;
    setRevealCount(1);
    let i = 1;
    const step = () => {
      if (cancelled || i >= compressed.length) return;
      const dur = compressed[i - 1]?.duration_ms ?? 0;
      // Scale real durations 10× down, floor 150ms, cap 1200ms.
      const delay = Math.min(1200, Math.max(150, Math.round(dur / 10)));
      const timer = setTimeout(() => {
        if (cancelled) return;
        i += 1;
        setRevealCount(i);
        if (i < compressed.length) step();
      }, delay);
      return () => clearTimeout(timer);
    };
    step();
    return () => {
      cancelled = true;
    };
  }, [compressed]);

  // Pending shell — visible while running and no trace yet.
  if (running && compressed.length === 0) {
    return (
      <Card className="border-lamp/30">
        <CardContent className="p-5">
          <TraceHeader running />
          <ul className="mt-4 space-y-2">
            {DEFAULT_PIPELINE.map((agent, i) => {
              const state: "done" | "active" | "pending" =
                i < pendingIndex ? "done" : i === pendingIndex ? "active" : "pending";
              return (
                <li key={agent} className="flex items-center gap-3 text-sm">
                  {state === "active" && (
                    <Loader2 className="size-4 animate-spin text-lamp" />
                  )}
                  {state === "done" && (
                    <CheckCircle2 className="size-4 text-muted-foreground/60" />
                  )}
                  {state === "pending" && (
                    <CircleDashed className="size-4 text-muted-foreground/40" />
                  )}
                  <span
                    className={cn(
                      "flex-1 transition-colors",
                      state === "active" && "text-foreground",
                      state === "done" && "text-muted-foreground/80",
                      state === "pending" && "text-muted-foreground/60",
                    )}
                  >
                    {AGENT_LABEL[agent] ?? agent}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    );
  }

  if (!compressed.length) return null;

  return (
    <Card className="border-lamp/30">
      <CardContent className="p-5">
        <TraceHeader running={running} />
        <ul className="mt-4 space-y-2">
          {compressed.map((step, i) => {
            const revealed = i < revealCount;
            return (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-3 text-sm transition-opacity duration-300",
                  revealed ? "opacity-100" : "opacity-0",
                )}
              >
                <StepIcon status={step.status} />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">
                      {AGENT_LABEL[step.agent] ?? step.agent}
                    </p>
                    {step.duration_ms > 0 && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {formatMs(step.duration_ms)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{step.summary}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function TraceHeader({ running }: { running: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <LampSignature glowing={running} />
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Agent trace
        </p>
        <p className="text-xs text-muted-foreground">
          {running ? "Working through the pipeline…" : "Pipeline complete"}
        </p>
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: TraceEvent["status"] }) {
  if (status === "complete")
    return (
      <CheckCircle2 className="size-4 text-[color:var(--color-verdict-safe)]" />
    );
  if (status === "skipped")
    return <MinusCircle className="size-4 text-muted-foreground" />;
  if (status === "error")
    return (
      <AlertCircle className="size-4 text-[color:var(--color-verdict-significant)]" />
    );
  return <Loader2 className="size-4 animate-spin text-lamp" />;
}

// Collapse `start` + `complete`/`error`/`skipped` for the same agent into
// one row keyed by the terminal event. If no terminal event lands, keep
// the start row so the user still sees it.
function compress(events: TraceEvent[]): TraceEvent[] {
  const byAgent = new Map<string, TraceEvent>();
  const order: string[] = [];
  for (const ev of events) {
    if (!byAgent.has(ev.agent)) order.push(ev.agent);
    const prev = byAgent.get(ev.agent);
    // Terminal events replace an earlier `start`; anything else keeps
    // whichever landed later.
    const isTerminal = ev.status !== "start";
    if (!prev || isTerminal) byAgent.set(ev.agent, ev);
  }
  return order.map((a) => byAgent.get(a)!);
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
