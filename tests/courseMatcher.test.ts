// Ported 1:1 from backend/tests/test_course_matcher.py.
//
// We spy on `matcherDeps.searchCatalog` / `matcherDeps.getClient` /
// `matcherDeps.askLlm` — the module-level indirection object exists
// so tests don't need vi.mock at the module-graph level.
import { afterEach, describe, expect, it, vi } from "vitest";
import { matcherDeps, matchCourse } from "@/lib/server/agents/courseMatcher";
import type { CourseMatchOut } from "@/lib/server/schemas/matcher";

function cand(
  sim: number,
  code = "CS 201",
  title = "Data Structures",
): Record<string, unknown> {
  return {
    id: `row-${code.replace(/\s+/g, "-").toLowerCase()}`,
    course_code: code,
    title,
    description: `${title} — auto description`,
    credits: 3,
    level: "undergraduate",
    similarity: sim,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function runMatch(query: string): Promise<CourseMatchOut> {
  return await matchCourse(query);
}

describe("course matcher", () => {
  it("no_candidates_returned", async () => {
    vi.spyOn(matcherDeps, "searchCatalog").mockResolvedValue([]);
    const result = await runMatch("nothing here");
    expect(result.match).toBeNull();
    expect(result.decision).toBe("no_candidates");
    expect(result.candidates).toEqual([]);
  });

  it("auto_accept_when_similarity_above_threshold", async () => {
    vi.spyOn(matcherDeps, "searchCatalog").mockResolvedValue([
      cand(0.95, "CS 410", "Databases"),
    ]);
    const result = await runMatch("Databases");
    expect(result.decision).toBe("auto_accept");
    expect(result.match).not.toBeNull();
    expect(result.match!.course_code).toBe("CS 410");
    expect(result.confidence).toBeCloseTo(0.95);
  });

  it("below_no_match_floor", async () => {
    vi.spyOn(matcherDeps, "searchCatalog").mockResolvedValue([
      cand(0.05, "BUS 101", "Intro Business"),
    ]);
    const result = await runMatch("quantum thermodynamics");
    expect(result.match).toBeNull();
    expect(result.decision).toBe("no_match");
    expect(result.confidence).toBe(0);
  });

  it("llm_unavailable_returns_top_hit_low_confidence", async () => {
    vi.spyOn(matcherDeps, "searchCatalog").mockResolvedValue([
      cand(0.4, "CS 201", "Data Structures"),
    ]);
    vi.spyOn(matcherDeps, "getClient").mockReturnValue(null);
    const result = await runMatch("something like data structures");
    expect(result.decision).toBe("llm_unavailable");
    expect(result.match).not.toBeNull();
    expect(result.match!.course_code).toBe("CS 201");
    expect(result.confidence).toBeCloseTo(0.4);
  });

  it("llm_pick_selects_by_id", async () => {
    vi.spyOn(matcherDeps, "searchCatalog").mockResolvedValue([
      cand(0.55, "CS 250", "Intro to Programming"),
      cand(0.42, "CS 201", "Data Structures"),
      cand(0.31, "CS 310", "Computer Science Core II"),
    ]);
    // Non-null placeholder so the null-check passes.
    vi.spyOn(matcherDeps, "getClient").mockReturnValue({} as never);
    vi.spyOn(matcherDeps, "askLlm").mockResolvedValue({
      chosen_id: "row-cs-201",
      reasoning: "Data Structures matches the intent 'lists/trees/hash tables'.",
    });

    const result = await runMatch("lists and hash tables class");
    expect(result.decision).toBe("llm_pick");
    expect(result.match).not.toBeNull();
    expect(result.match!.course_code).toBe("CS 201");
    expect(result.reasoning).toContain("Data Structures");
  });

  it("llm_declined_returns_none", async () => {
    vi.spyOn(matcherDeps, "searchCatalog").mockResolvedValue([cand(0.4)]);
    vi.spyOn(matcherDeps, "getClient").mockReturnValue({} as never);
    vi.spyOn(matcherDeps, "askLlm").mockResolvedValue({
      chosen_id: null,
      reasoning: "Query is unrelated to any candidate.",
    });
    const result = await runMatch("underwater basket weaving");
    expect(result.match).toBeNull();
    expect(result.decision).toBe("llm_declined");
    expect(result.confidence).toBe(0);
  });

  it("llm_returns_invalid_id_falls_back_to_top_hit", async () => {
    vi.spyOn(matcherDeps, "searchCatalog").mockResolvedValue([cand(0.4)]);
    vi.spyOn(matcherDeps, "getClient").mockReturnValue({} as never);
    vi.spyOn(matcherDeps, "askLlm").mockResolvedValue({
      chosen_id: "nonexistent-id",
      reasoning: "ignored",
    });
    const result = await runMatch("something");
    expect(result.decision).toBe("llm_invalid_id");
    expect(result.match).not.toBeNull(); // fell back to top hit
    expect(result.confidence).toBeCloseTo(0.4);
  });

  it("llm_error_falls_back", async () => {
    vi.spyOn(matcherDeps, "searchCatalog").mockResolvedValue([cand(0.5)]);
    vi.spyOn(matcherDeps, "getClient").mockReturnValue({} as never);
    vi.spyOn(matcherDeps, "askLlm").mockRejectedValue(
      new Error("rate limited"),
    );
    const result = await runMatch("something");
    expect(result.decision).toBe("llm_error");
    expect(result.match).not.toBeNull();
    expect(result.reasoning).toContain("rate limited");
  });
});
