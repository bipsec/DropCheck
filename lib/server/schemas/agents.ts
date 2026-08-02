// Zod schemas for agent I/O — ported 1:1 from backend/app/schemas/agents.py.
//
// The Python source uses Pydantic aliases (`bottomLine`, `hasImpact`, etc.)
// so the *wire format* is camelCase even though Python fields are snake_case.
// We drop the alias layer here and use camelCase natively — the frontend
// already consumes camelCase, and every internal caller in the port will
// also read/write camelCase directly. One naming convention, one less
// place for silent drift.

import { z } from "zod";

export const VerdictLevel = z.enum(["no_impact", "watch", "significant"]);
export type VerdictLevel = z.infer<typeof VerdictLevel>;

export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

export const Domain = z.enum(["academic", "financial", "status"]);
export type Domain = z.infer<typeof Domain>;

// `strict()` is Pydantic's `extra="forbid"` equivalent. Trimming strings is
// safer than trusting the model to strip whitespace itself.
const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const trim = z.string().trim();

export const Citation = strict({
  // Pydantic aliased this to `from` — but `from` is a reserved word in JS.
  // We keep it as `from` on the wire (matches the current backend) and
  // just have to remember to bracket-access it in code.
  from: z.enum(["resolver", "policy"]),
  field: trim.max(120),
});
export type Citation = z.infer<typeof Citation>;

export const NextStep = strict({
  label: trim.max(80),
  detail: trim.max(280),
  contact: trim.max(160).nullable().optional(),
});
export type NextStep = z.infer<typeof NextStep>;

export const DecisionFrame = strict({
  restatement: trim.max(220),
  ambiguities: z.array(trim).max(4).default([]),
  focusDomains: z.array(Domain).min(1).max(3),
});
export type DecisionFrame = z.infer<typeof DecisionFrame>;

export const DomainReport = strict({
  verdict: VerdictLevel,
  headline: trim.max(120),
  reasoning: trim.max(400),
  citations: z.array(Citation).min(1).max(6),
  nextStep: NextStep.nullable().optional(),
});
export type DomainReport = z.infer<typeof DomainReport>;

export const Panel = strict({
  domain: Domain,
  verdict: trim.max(140),
  detail: trim.max(420),
  nextStep: trim.max(80).nullable().optional(),
  nextStepDetail: trim.max(320).nullable().optional(),
  hasImpact: z.boolean(),
});
export type Panel = z.infer<typeof Panel>;

export const DiagramNode = strict({
  id: trim.max(24),
  label: trim.max(48),
  kind: z.enum(["dropped", "downstream", "prereq", "context"]),
});
export type DiagramNode = z.infer<typeof DiagramNode>;

export const DiagramEdge = strict({
  from: trim.max(24),
  to: trim.max(24),
});
export type DiagramEdge = z.infer<typeof DiagramEdge>;

export const DiagramSpec = strict({
  nodes: z.array(DiagramNode).max(24),
  edges: z.array(DiagramEdge).max(48),
});
export type DiagramSpec = z.infer<typeof DiagramSpec>;

export const PlotSeries = strict({
  label: trim.max(40),
  credits: z.number().min(0).max(30),
});
export type PlotSeries = z.infer<typeof PlotSeries>;

export const PlotThreshold = strict({
  label: trim.max(40),
  value: z.number().min(0).max(30),
  domain: Domain,
});
export type PlotThreshold = z.infer<typeof PlotThreshold>;

export const PlotSpec = strict({
  title: trim.max(80),
  yAxisLabel: trim.max(40),
  series: z.array(PlotSeries).min(2).max(4),
  thresholds: z.array(PlotThreshold).max(4),
});
export type PlotSpec = z.infer<typeof PlotSpec>;

export const SynthSource = strict({
  claim: trim.max(200),
  sourceAgent: z.enum(["academic", "financial", "status", "resolver"]),
  sourceCitation: trim.max(120),
});
export type SynthSource = z.infer<typeof SynthSource>;

export const FinalMeta = strict({
  mode: z.enum(["agents", "fallback"]).default("fallback"),
  degraded: z.boolean().default(false),
  note: trim.max(200).nullable().optional(),
});
export type FinalMeta = z.infer<typeof FinalMeta>;

export const FinalPayload = strict({
  course: trim.max(20),
  headline: trim.max(140),
  bottomLine: trim.max(280),
  confidence: Confidence,
  panels: z.array(Panel).length(3),
  diagram: DiagramSpec,
  plot: PlotSpec,
  sources: z.array(SynthSource).max(24).default([]),
  meta: FinalMeta.default({ mode: "fallback", degraded: false }),
});
export type FinalPayload = z.infer<typeof FinalPayload>;

// Only used by the graph runner to bundle streamed reports (never
// serialized to the wire).
export const AgentTrace = strict({
  frame: DecisionFrame.nullable().optional(),
  academic: DomainReport.nullable().optional(),
  financial: DomainReport.nullable().optional(),
  status: DomainReport.nullable().optional(),
});
export type AgentTrace = z.infer<typeof AgentTrace>;
