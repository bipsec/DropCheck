// Simplified graph-node schemas — ported 1:1 from
// backend/app/agents/schemas_graph.py.
//
// These are the tool_use-friendly versions of the shapes in
// lib/server/schemas/agents.ts. Anthropic's structured-output validator
// times out on:
//   - `z.string().max(N)` inside deeply nested objects
//   - field aliases like `from` (JS reserved-ish; already lower-cased)
//
// We keep the exact conceptual shape (Citation, DomainReport, etc.) but
// drop the max-length constraints. Prompts enforce brevity; Zod
// validates on the way back for null/type safety.

import { z } from "zod";

export const VerdictLevel = z.enum(["no_impact", "watch", "significant"]);
export type VerdictLevel = z.infer<typeof VerdictLevel>;

export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

export const Domain = z.enum(["academic", "financial", "status"]);
export type Domain = z.infer<typeof Domain>;

export const CitationSource = z.enum(["resolver", "finance", "context", "policy"]);
export type CitationSource = z.infer<typeof CitationSource>;

const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const trim = z.string().trim();

export const GraphCitation = strict({
  source: CitationSource,
  field: trim,
});
export type GraphCitation = z.infer<typeof GraphCitation>;

export const GraphNextStep = strict({
  label: trim,
  detail: trim,
  contact: trim.nullable().optional(),
});
export type GraphNextStep = z.infer<typeof GraphNextStep>;

export const GraphDecisionFrame = strict({
  restatement: trim,
  ambiguities: z.array(trim).default([]),
  focus_domains: z.array(Domain).min(1).max(3),
});
export type GraphDecisionFrame = z.infer<typeof GraphDecisionFrame>;

export const GraphDomainReport = strict({
  verdict: VerdictLevel,
  headline: trim,
  reasoning: trim,
  citations: z.array(GraphCitation),
  next_step: GraphNextStep.nullable().optional(),
});
export type GraphDomainReport = z.infer<typeof GraphDomainReport>;

export const GraphPanel = strict({
  domain: Domain,
  verdict: trim,
  detail: trim,
  next_step: trim.nullable().optional(),
  next_step_detail: trim.nullable().optional(),
  has_impact: z.boolean(),
});
export type GraphPanel = z.infer<typeof GraphPanel>;

export const GraphSynthOutput = strict({
  headline: trim,
  bottom_line: trim,
  confidence: Confidence,
  panels: z.array(GraphPanel).length(3),
  sources: z.array(GraphCitation).default([]),
});
export type GraphSynthOutput = z.infer<typeof GraphSynthOutput>;

export const RouteKind = z.enum(["new_course_check", "clarification", "what_if"]);
export type RouteKind = z.infer<typeof RouteKind>;

export const HypotheticalDrop = strict({
  course_hint: trim,
});
export type HypotheticalDrop = z.infer<typeof HypotheticalDrop>;

export const RouterDecision = strict({
  kind: RouteKind,
  reasoning: trim,
  additional_drops: z.array(HypotheticalDrop).default([]),
});
export type RouterDecision = z.infer<typeof RouterDecision>;

export const ClarificationAnswer = strict({
  headline: trim,
  answer: trim,
  confidence: Confidence,
  sources: z.array(GraphCitation).default([]),
});
export type ClarificationAnswer = z.infer<typeof ClarificationAnswer>;
