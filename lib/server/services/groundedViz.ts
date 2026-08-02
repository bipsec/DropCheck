// Grounded visualization builder — computes diagram + plot from the
// resolver dict, deterministically. Never asks the model. Every value
// traces back to a resolver / bundle field, so this can't hallucinate.
//
// Used by queryRun.extractFinal on the agents path (LangGraph synth
// only returns headline/panels/sources; the older Python design punted
// diagram+plot to the frontend/fallback path). We surface them for the
// agents path too so the visualization is always available.

import { POLICY } from "@/lib/server/data/policy";
import type { QueryContextBundle } from "@/lib/server/services/queryContext";

export interface VizDiagramNode {
  id: string;
  label: string;
  kind: "dropped" | "downstream" | "prereq";
}
export interface VizDiagramEdge {
  from: string;
  to: string;
}
export interface VizDiagram {
  nodes: VizDiagramNode[];
  edges: VizDiagramEdge[];
}

export interface VizPlotSeries {
  label: string;
  credits: number;
}
export interface VizPlotThreshold {
  label: string;
  value: number;
  domain: "financial" | "status";
}
export interface VizPlot {
  title: string;
  yAxisLabel: string;
  series: VizPlotSeries[];
  thresholds: VizPlotThreshold[];
}

export function buildGroundedDiagram(
  resolver: Record<string, unknown>,
  bundle: QueryContextBundle,
): VizDiagram {
  const course = (resolver.course as Record<string, unknown>) ?? {};
  const prereqCtx = (resolver.prereqs as Record<string, unknown>) ?? {};

  const droppedCode = String(course.code ?? bundle.course_code);
  const prereqs = ((course.prereqs as string[]) ?? []).slice(0, 4);
  const downstream = ((prereqCtx.downstream as string[]) ?? []).slice(0, 6);

  const nodes: VizDiagramNode[] = [
    { id: droppedCode, label: droppedCode, kind: "dropped" },
  ];
  const edges: VizDiagramEdge[] = [];

  for (const p of prereqs) {
    nodes.push({ id: p, label: p, kind: "prereq" });
    edges.push({ from: p, to: droppedCode });
  }
  for (const d of downstream) {
    nodes.push({ id: d, label: d, kind: "downstream" });
    edges.push({ from: droppedCode, to: d });
  }
  return { nodes, edges };
}

export function buildGroundedPlot(
  resolver: Record<string, unknown>,
  bundle: QueryContextBundle,
): VizPlot {
  const course = (resolver.course as Record<string, unknown>) ?? {};
  const student = (resolver.student as Record<string, unknown>) ?? {};
  const after = (resolver.afterDrop as Record<string, unknown>) ?? {};

  const before = Number(student.totalCredits ?? 0);
  const afterCredits = Number(after.credits ?? 0);
  const international = Boolean(student.international);

  const thresholds: VizPlotThreshold[] = [
    { label: `Full-time (${POLICY.FULL_TIME_MIN})`, value: POLICY.FULL_TIME_MIN, domain: "financial" },
    { label: `Half-time (${POLICY.HALF_TIME_MIN})`, value: POLICY.HALF_TIME_MIN, domain: "financial" },
  ];
  if (international) {
    thresholds.push({
      label: `F-1 minimum (${POLICY.F1_FULL_LOAD_MIN})`,
      value: POLICY.F1_FULL_LOAD_MIN,
      domain: "status",
    });
  }

  return {
    title: `Credits before vs. after dropping ${bundle.course_code}`,
    yAxisLabel: "Credits",
    series: [
      { label: "Before", credits: Math.max(0, before) },
      { label: "After", credits: Math.max(0, afterCredits) },
    ],
    thresholds,
  };
}
