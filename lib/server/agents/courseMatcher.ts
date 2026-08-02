// Course-matcher agent — ported 1:1 from
// backend/app/agents/course_matcher.py.
//
// Pipeline:
//   1. Embed the query, pull top-k candidates via pgvector.
//   2. Top hit ≥ AUTO_ACCEPT? → return it verbatim.
//   3. Top hit < NO_MATCH_FLOOR? → return null.
//   4. Else → ask Claude to pick from candidates (or decline).
//
// Never throws on LLM errors — every failure path returns a
// CourseMatchOut with a distinct `decision` code so the UI can render
// the exact state (llm_unavailable, llm_pick, llm_declined, etc.).

import { AnthropicUnavailable, DEFAULT_MODEL, getClient, runTool } from "@/lib/server/agents/client";
import { COURSE_MATCH_SYSTEM } from "@/lib/server/agents/prompts";
import {
  CourseMatchOut,
  LLMMatchDecision,
  MatchCandidate,
} from "@/lib/server/schemas/matcher";
import { searchCatalog } from "@/lib/server/services/catalog";

export const AUTO_ACCEPT_SIMILARITY = 0.92;
export const NO_MATCH_FLOOR = 0.15;

// Deps object so tests can swap out the dependencies without needing
// vi.mock at the module graph level. Vitest's `vi.spyOn(matcherDeps, ...)`
// hits these; production code just calls them.
export const matcherDeps = {
  searchCatalog,
  getClient,
  askLlm,
};

export async function matchCourse(
  query: string,
  topK: number = 5,
): Promise<CourseMatchOut> {
  const rawRows = await matcherDeps.searchCatalog(query, topK);
  const candidates = rawRows.map((row) => MatchCandidate.parse(row));

  if (candidates.length === 0) {
    return CourseMatchOut.parse({
      query,
      match: null,
      confidence: 0,
      decision: "no_candidates",
      candidates: [],
      reasoning: "No catalog rows matched the query embedding.",
    });
  }

  const top = candidates[0];

  if (top.similarity >= AUTO_ACCEPT_SIMILARITY) {
    return CourseMatchOut.parse({
      query,
      match: top,
      confidence: top.similarity,
      decision: "auto_accept",
      candidates,
      reasoning:
        `Top candidate similarity ${top.similarity.toFixed(3)} clears the ` +
        `auto-accept threshold (${AUTO_ACCEPT_SIMILARITY}).`,
    });
  }

  if (top.similarity < NO_MATCH_FLOOR) {
    return CourseMatchOut.parse({
      query,
      match: null,
      confidence: 0,
      decision: "no_match",
      candidates,
      reasoning:
        `Top similarity ${top.similarity.toFixed(3)} is below the ` +
        `no-match floor (${NO_MATCH_FLOOR}).`,
    });
  }

  if (matcherDeps.getClient() === null) {
    return CourseMatchOut.parse({
      query,
      match: top,
      confidence: top.similarity,
      decision: "llm_unavailable",
      candidates,
      reasoning:
        "Anthropic client not configured — returning the top embedding " +
        "hit as a low-confidence guess. Confirm manually in the UI.",
    });
  }

  let decision: LLMMatchDecision;
  try {
    decision = await matcherDeps.askLlm(query, candidates);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return CourseMatchOut.parse({
      query,
      match: top,
      confidence: top.similarity,
      decision: "llm_error",
      candidates,
      reasoning: `LLM disambiguation failed: ${message}. Falling back to top embedding hit.`,
    });
  }

  if (decision.chosen_id == null) {
    return CourseMatchOut.parse({
      query,
      match: null,
      confidence: 0,
      decision: "llm_declined",
      candidates,
      reasoning: decision.reasoning,
    });
  }

  const chosen = candidates.find((c) => c.id === decision.chosen_id);
  if (!chosen) {
    return CourseMatchOut.parse({
      query,
      match: top,
      confidence: top.similarity,
      decision: "llm_invalid_id",
      candidates,
      reasoning:
        `LLM returned unknown id ${JSON.stringify(decision.chosen_id)}. ` +
        "Falling back to top embedding hit.",
    });
  }

  return CourseMatchOut.parse({
    query,
    match: chosen,
    confidence: chosen.similarity,
    decision: "llm_pick",
    candidates,
    reasoning: decision.reasoning,
  });
}

async function askLlm(
  query: string,
  candidates: readonly MatchCandidate[],
): Promise<LLMMatchDecision> {
  const lines: string[] = [`Student input: ${JSON.stringify(query)}`, ""];
  lines.push("Candidates (sorted by embedding similarity, highest first):");
  for (const c of candidates) {
    let desc = (c.description ?? "").trim().replace(/\n/g, " ");
    if (desc.length > 200) desc = desc.slice(0, 197) + "...";
    lines.push(
      `  id=${c.id}  code=${c.course_code}  title=${JSON.stringify(c.title)}  ` +
        `level=${c.level ?? "-"}  similarity=${c.similarity.toFixed(3)}\n` +
        `    desc: ${desc}`,
    );
  }
  lines.push("");
  lines.push(
    "Return the best-matching candidate id, or null if none is a plausible match. " +
      "Explain in one sentence.",
  );
  const user = lines.join("\n");

  try {
    return await runTool({
      system: COURSE_MATCH_SYSTEM,
      user,
      schema: LLMMatchDecision,
      toolName: "record_match_decision",
      toolDescription: "Record the course-matcher's decision.",
      // Haiku is enough for this single constrained decision — the
      // reasoning agents get Opus.
      model: DEFAULT_MODEL,
      maxTokens: 1024,
    });
  } catch (err) {
    if (err instanceof AnthropicUnavailable) throw err;
    // Zod parse errors / network failures land here.
    const message = err instanceof Error ? err.message : String(err);
    throw new AnthropicUnavailable(message);
  }
}
