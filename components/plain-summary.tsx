"use client";

import { Card, CardContent } from "@/components/ui/card";
import type {
  FinalDiagram,
  FinalPayload,
  FinalPlot,
  Panel,
} from "@/lib/api-types";

type Props = {
  final: FinalPayload;
};

/**
 * Plain-English narrative built from the grounded fields on FinalPayload.
 * Deterministic — everything here traces back to a panel/plot/diagram
 * value the server already emitted, so this can't hallucinate.
 *
 * Renders three short paragraphs (the story), a "what to do next"
 * checklist, and a numbers strip — all in normal prose, no jargon,
 * no citation chips.
 */
export function PlainSummary({ final }: Props) {
  const panels = orderPanels(final.panels);
  const [academic, financial, status] = panels;
  const bottomLine = final.bottomLine ?? final.bottom_line ?? "";

  const nextSteps = panels
    .filter((p) => p.nextStep)
    .map((p) => ({
      domain: p.domain,
      label: p.nextStep!,
      detail: p.nextStepDetail ?? null,
    }));

  const highlights = buildHighlights(final.plot, final.diagram);

  return (
    <Card>
      <CardContent className="p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          In plain terms
        </p>

        <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/90">
          {bottomLine && <p>{bottomLine}</p>}
          {academic && (
            <p>
              <span className="font-medium text-foreground">Academically:</span>{" "}
              {academic.detail || academic.verdict}
            </p>
          )}
          {financial && (
            <p>
              <span className="font-medium text-foreground">On your aid:</span>{" "}
              {financial.detail || financial.verdict}
            </p>
          )}
          {status && (
            <p>
              <span className="font-medium text-foreground">Enrollment status:</span>{" "}
              {status.detail || status.verdict}
            </p>
          )}
        </div>

        {highlights.length > 0 && (
          <div className="mt-5 grid gap-3 rounded-md border border-border/60 bg-muted/30 p-4 sm:grid-cols-3">
            {highlights.map((h, i) => (
              <div key={i}>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {h.label}
                </p>
                <p className="mt-1 text-sm font-medium">{h.value}</p>
                {h.hint && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{h.hint}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {nextSteps.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-medium">What to do next</p>
            <ul className="mt-2 space-y-2 text-sm">
              {nextSteps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-lamp"
                  />
                  <div>
                    <span className="font-medium">{s.label}</span>
                    {s.detail && (
                      <span className="text-muted-foreground"> — {s.detail}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function orderPanels(panels: Panel[]): Panel[] {
  const order: Record<Panel["domain"], number> = {
    academic: 0,
    financial: 1,
    status: 2,
  };
  return [...panels].sort((a, b) => order[a.domain] - order[b.domain]);
}

// Build a compact "by the numbers" strip from the plot + diagram data,
// each row worded as a plain-English fact rather than a field name.
function buildHighlights(
  plot: FinalPlot | null | undefined,
  diagram: FinalDiagram | null | undefined,
): Array<{ label: string; value: string; hint?: string }> {
  const out: Array<{ label: string; value: string; hint?: string }> = [];

  if (plot && plot.series.length >= 2) {
    const before = plot.series[0].credits;
    const after = plot.series[plot.series.length - 1].credits;
    const delta = after - before;
    const fullTime = plot.thresholds.find((t) =>
      /full/i.test(t.label),
    )?.value;
    let hint: string | undefined;
    if (fullTime != null) {
      if (after < fullTime) hint = `${fullTime - after} below full-time`;
      else hint = `${after - fullTime} above full-time`;
    }
    out.push({
      label: "Credits after drop",
      value: `${after} (was ${before}${delta === 0 ? "" : `, ${delta > 0 ? "+" : ""}${delta}`})`,
      hint,
    });
  }

  if (diagram) {
    const downstream = diagram.nodes.filter((n) => n.kind === "downstream");
    const prereqs = diagram.nodes.filter((n) => n.kind === "prereq");
    if (downstream.length > 0) {
      out.push({
        label: "Blocks downstream",
        value: `${downstream.length} course${downstream.length === 1 ? "" : "s"}`,
        hint: downstream
          .slice(0, 3)
          .map((n) => n.label)
          .join(", ") + (downstream.length > 3 ? ", …" : ""),
      });
    }
    if (prereqs.length > 0) {
      out.push({
        label: "Built on",
        value: `${prereqs.length} prereq${prereqs.length === 1 ? "" : "s"}`,
        hint: prereqs.map((n) => n.label).join(", "),
      });
    }
  }

  return out.slice(0, 3);
}
