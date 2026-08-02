"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConsequenceCard } from "@/components/consequence-card";
import { CreditPlot } from "@/components/credit-plot";
import { PlainSummary } from "@/components/plain-summary";
import { PrereqDiagram } from "@/components/prereq-diagram";
import type { FinalPayload, Panel } from "@/lib/api-types";

type Props = {
  final: FinalPayload;
  courseCode?: string;
};

/**
 * Rendered payload from /query or /query/{id}/followup. Handles three
 * meta.mode variants:
 *   - "agents"        → primary rendering, full 3-panel layout
 *   - "clarification" → same shape but the first panel carries the answer
 *   - "fallback"      → adds a "degraded" banner so students know we
 *                       couldn't ground the answer against their profile
 */
export function ResultView({ final, courseCode }: Props) {
  const bottomLine = final.bottomLine ?? final.bottom_line ?? "";
  const orderedPanels = orderPanels(final.panels);
  const isClarification = final.meta.mode === "clarification";
  const isFallback = final.meta.mode === "fallback";

  return (
    <div className="space-y-5">
      <Card className={isFallback ? "border-[color:var(--color-verdict-watch)]/40" : undefined}>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-baseline gap-3">
            {courseCode && (
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {courseCode}
              </span>
            )}
            <ConfidenceBadge confidence={final.confidence} />
            {isClarification && <Badge variant="lamp">Clarification</Badge>}
            {isFallback && (
              <Badge variant="watch">
                <AlertTriangle className="mr-0.5 size-3" />
                Deterministic fallback
              </Badge>
            )}
            {final.meta.mode === "agents" && !isFallback && (
              <Badge variant="safe">
                <ShieldCheck className="mr-0.5 size-3" />
                Agents grounded
              </Badge>
            )}
          </div>
          <h2 className="mt-3 font-display text-2xl font-semibold leading-tight tracking-tight">
            {final.headline}
          </h2>
          {bottomLine && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {bottomLine}
            </p>
          )}
          {isFallback && final.meta.note && (
            <p className="mt-3 rounded-md border border-[color:var(--color-verdict-watch)]/40 bg-[color:var(--color-verdict-watch)]/10 px-3 py-2 text-xs text-[color:var(--color-verdict-watch)]">
              {final.meta.note}
            </p>
          )}
        </CardContent>
      </Card>

      {!isClarification && (
        <div className="grid gap-4 md:grid-cols-3">
          {orderedPanels.map((panel) => (
            <ConsequenceCard key={panel.domain} panel={panel} />
          ))}
        </div>
      )}

      {!isClarification && (final.plot || final.diagram) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {final.plot && <CreditPlot plot={final.plot} />}
          {final.diagram && <PrereqDiagram diagram={final.diagram} />}
        </div>
      )}

      {!isClarification && <PlainSummary final={final} />}
    </div>
  );
}

// Some backends emit panels in a different order per run; force the
// academic → financial → status order the plan specifies.
function orderPanels(panels: Panel[]): Panel[] {
  const order: Record<Panel["domain"], number> = {
    academic: 0,
    financial: 1,
    status: 2,
  };
  return [...panels].sort((a, b) => order[a.domain] - order[b.domain]);
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: FinalPayload["confidence"];
}) {
  const variant =
    confidence === "high" ? "safe" : confidence === "low" ? "significant" : "lamp";
  return <Badge variant={variant}>Confidence: {confidence}</Badge>;
}
