// Course-matcher I/O schemas — ported 1:1 from backend/app/schemas/matcher.py.

import { z } from "zod";

const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const trim = z.string().trim();

export const MatchCandidate = strict({
  id: z.string(),
  course_code: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  credits: z.number().nullable().optional(),
  level: z.string().nullable().optional(),
  similarity: z.number(),
});
export type MatchCandidate = z.infer<typeof MatchCandidate>;

// Structured decision the disambiguation LLM must return. Deliberately
// flat (no bounds, no aliases) so Anthropic's tool grammar compiler
// doesn't reject it — same rationale as the extraction schema.
export const LLMMatchDecision = strict({
  chosen_id: z.string().nullable().optional().describe(
    "ID of the best-matching candidate, or null if no candidate is a plausible match.",
  ),
  reasoning: z.string().describe(
    "One-sentence justification. Reference the code, title, and description.",
  ),
});
export type LLMMatchDecision = z.infer<typeof LLMMatchDecision>;

export const CourseMatchIn = strict({
  query: trim.min(1).max(200),
  program: trim.max(32).nullable().optional(),
  top_k: z.number().int().min(1).max(20).default(5),
});
export type CourseMatchIn = z.infer<typeof CourseMatchIn>;

export const CourseMatchOut = z.object({
  query: z.string(),
  match: MatchCandidate.nullable(),
  confidence: z.number().min(0).max(1),
  decision: z.string(),
  candidates: z.array(MatchCandidate),
  reasoning: z.string().nullable().optional(),
});
export type CourseMatchOut = z.infer<typeof CourseMatchOut>;
