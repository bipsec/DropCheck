// Wire schemas for POST /api/query, POST /api/query/{id}/followup, and
// GET /api/conversations. Ported 1:1 from backend/app/schemas/query.py.

import { z } from "zod";

const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const trim = z.string().trim();

export const QueryIn = strict({
  course: trim.min(1).max(200),
  question: trim.min(1).max(1000),
});
export type QueryIn = z.infer<typeof QueryIn>;

export const FollowupIn = strict({
  question: trim.min(1).max(1000),
});
export type FollowupIn = z.infer<typeof FollowupIn>;

export const TraceEventOut = z.object({
  agent: z.string(),
  status: z.string(),
  summary: z.string(),
  duration_ms: z.number().int(),
});
export type TraceEventOut = z.infer<typeof TraceEventOut>;
