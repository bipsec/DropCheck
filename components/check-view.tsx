"use client";

import * as React from "react";
import { toast } from "sonner";

import Link from "next/link";
import { AlertTriangle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QueryForm } from "@/components/query-form";
import { AgentTracePanel } from "@/components/agent-trace-panel";
import { TurnList } from "@/components/turn-list";
import { FollowupComposer } from "@/components/followup-composer";
import { ConversationHistory } from "@/components/conversation-history";
import {
  getConversation,
  getProfile,
  submitFollowup,
  submitQuery,
} from "@/lib/api";
import type {
  Completeness,
  ConversationTurn,
  QueryOut,
  TraceEvent,
} from "@/lib/api-types";

/**
 * Orchestrator for /check.
 *
 * State model:
 *   - `turns`         : the full thread being displayed. Grows on
 *                       every new-turn append; replaced when a past
 *                       conversation is loaded from history.
 *   - `courseCode`    : the course the pipeline is anchored to. Set on
 *                       first turn, kept for follow-ups + history reloads.
 *   - `latestTrace`   : the trace events from the *most recent* live
 *                       response. Cleared when history is loaded (server
 *                       doesn't return trace on GET /conversations).
 *   - `conversationId`: the live conversation id. Follow-ups POST to
 *                       /query/{id}/followup; new-turn submissions null it
 *                       to force a fresh conversation.
 *   - `running`       : true from submit-fired until response lands. Locks
 *                       the composer.
 *   - `historyToken`  : bumped after every successful turn so the
 *                       sidebar list re-fetches without a ref.
 */
export function CheckView() {
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [courseCode, setCourseCode] = React.useState<string | undefined>();
  const [turns, setTurns] = React.useState<ConversationTurn[]>([]);
  const [latestTrace, setLatestTrace] = React.useState<TraceEvent[] | null>(null);
  const [running, setRunning] = React.useState(false);
  const [historyToken, setHistoryToken] = React.useState(0);
  const [completeness, setCompleteness] = React.useState<Completeness | null>(null);

  // Preflight: pull the profile's completeness on mount so we can nudge
  // the student to fill it in *before* they submit a shaky query. Silent
  // on failure — the query itself will surface any real problem.
  React.useEffect(() => {
    let cancelled = false;
    getProfile()
      .then((p) => {
        if (!cancelled) setCompleteness(p.completeness);
      })
      .catch(() => {
        // Ignore — likely a session race; the query flow will fail loudly
        // if the session is truly gone.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetAll = React.useCallback(() => {
    setConversationId(null);
    setCourseCode(undefined);
    setTurns([]);
    setLatestTrace(null);
    setRunning(false);
  }, []);

  const appendPair = React.useCallback(
    (userText: string, out: QueryOut) => {
      const now = new Date().toISOString();
      const userTurn: ConversationTurn = {
        id: `local-user-${now}`,
        role: "user",
        query: userText,
        response: null,
        created_at: now,
      };
      const assistantTurn: ConversationTurn = {
        id: `local-assistant-${now}`,
        role: "assistant",
        query: null,
        response: out.final,
        created_at: now,
      };
      setTurns((prev) => [...prev, userTurn, assistantTurn]);
      setLatestTrace(out.trace_events);
      setConversationId(out.conversation_id);
      setCourseCode(out.course_code);
      setHistoryToken((n) => n + 1);
    },
    []
  );

  const handleFirstTurn = React.useCallback(
    async (course: string, question: string) => {
      setRunning(true);
      setLatestTrace(null);
      try {
        const out = await submitQuery({ course, question });
        appendPair(question, out);
        if (out.grounding_violations.length > 0) {
          toast.warning("Ran, but with grounding gaps", {
            description: `Synthesizer cited ${out.grounding_violations.length} field(s) outside the whitelist — used deterministic fallback.`,
          });
        }
      } catch (err) {
        toast.error("Query failed", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setRunning(false);
      }
    },
    [appendPair]
  );

  const handleFollowup = React.useCallback(
    async (question: string) => {
      if (!conversationId) return;
      setRunning(true);
      setLatestTrace(null);
      try {
        const out = await submitFollowup(conversationId, question);
        appendPair(question, out);
        if (out.route_kind === "clarification") {
          toast.message("Clarification path", {
            description: "Router routed as a clarification — no full re-run.",
          });
        } else if (out.route_kind === "what_if") {
          toast.message("What-if path", {
            description: `Re-ran the pipeline${
              out.hypothetical_drops?.length
                ? ` with ${out.hypothetical_drops.length} hypothetical drop(s).`
                : "."
            }`,
          });
        }
      } catch (err) {
        toast.error("Follow-up failed", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setRunning(false);
      }
    },
    [appendPair, conversationId]
  );

  const openConversation = React.useCallback(
    async (id: string) => {
      if (id === conversationId) return;
      setRunning(false);
      setLatestTrace(null);
      try {
        const detail = await getConversation(id);
        setConversationId(id);
        setCourseCode(detail.conversation.course_code ?? undefined);
        setTurns(detail.turns);
      } catch (err) {
        toast.error("Couldn't load conversation", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [conversationId]
  );

  const empty = turns.length === 0;

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Check impact
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Ask about a course
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The pipeline pulls your profile from the last save, matches the course
          against the catalog, and runs four agents in parallel. Follow-ups on
          the same thread stay in the same conversation.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-6">
          {empty && !conversationId && completeness && !completeness.meets_80 && (
            <ProfileNudge score={completeness.score} />
          )}

          {empty && !conversationId && (
            <QueryForm
              onSubmit={handleFirstTurn}
              submitting={running}
            />
          )}

          {(running || latestTrace) && (
            <AgentTracePanel trace={latestTrace} running={running} />
          )}

          {turns.length > 0 && <TurnList turns={turns} courseCode={courseCode} />}

          {conversationId && !running && (
            <FollowupComposer
              onSubmit={handleFollowup}
              submitting={running}
              disabled={running}
            />
          )}
        </div>

        <aside className="space-y-4">
          <ConversationHistory
            activeId={conversationId}
            onOpen={openConversation}
            onReset={resetAll}
            refreshToken={historyToken}
          />
        </aside>
      </div>
    </main>
  );
}

/**
 * Non-blocking pre-flight banner: the pipeline still runs at any
 * completeness, but a mostly-empty profile means the agents cite less
 * and confidence trends "low". Encourage a quick trip to /profile.
 */
function ProfileNudge({ score }: { score: number }) {
  const tone =
    score < 40
      ? {
          bg: "border-[color:var(--color-verdict-significant)]/40",
          icon: (
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[color:var(--color-verdict-significant)]" />
          ),
          copy: "Your profile is mostly empty. The agents can still run, but answers will lean on defaults instead of your actual situation.",
        }
      : {
          bg: "border-[color:var(--color-verdict-watch)]/40",
          icon: (
            <Sparkles className="mt-0.5 size-5 shrink-0 text-[color:var(--color-verdict-watch)]" />
          ),
          copy: `Profile is ${Math.round(score)}% complete. You can still ask, but responses get sharper the more the agents can cite.`,
        };
  return (
    <Card className={tone.bg}>
      <CardContent className="flex items-start gap-4 p-5">
        {tone.icon}
        <div className="flex-1">
          <p className="text-sm text-foreground">{tone.copy}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/profile">Fill it in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
