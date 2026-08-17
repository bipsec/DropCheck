import { describe, expect, it } from "vitest";
import {
  nextTerm,
  parseTermLabel,
  termsBetween,
} from "@/lib/server/services/termSequence";
import type { Term } from "@/lib/server/schemas/track";

describe("termSequence", () => {
  it("test_next_term_walks_fall_spring_summer", () => {
    let t: Term = { season: "Fall", year: 2026 };
    t = nextTerm(t);
    expect(t).toEqual({ season: "Spring", year: 2027 });
    t = nextTerm(t);
    expect(t).toEqual({ season: "Summer", year: 2027 });
    t = nextTerm(t);
    expect(t).toEqual({ season: "Fall", year: 2027 });
  });

  it("test_parse_term_label_round_trips", () => {
    expect(parseTermLabel("Fall 2026")).toEqual({ season: "Fall", year: 2026 });
    expect(parseTermLabel("  Spring 2027  ")).toEqual({
      season: "Spring",
      year: 2027,
    });
    expect(() => parseTermLabel("Winter 2027")).toThrow();
    expect(() => parseTermLabel("nonsense")).toThrow();
  });

  it("test_terms_between_counts_inclusive", () => {
    // Fall 2026 → Fall 2026 = 1 term
    expect(
      termsBetween(
        { season: "Fall", year: 2026 },
        { season: "Fall", year: 2026 },
      ),
    ).toBe(1);
    // Fall 2026 → Spring 2027 = 2 terms (Fall 2026, Spring 2027)
    expect(
      termsBetween(
        { season: "Fall", year: 2026 },
        { season: "Spring", year: 2027 },
      ),
    ).toBe(2);
    // Reverse direction clamps to 0.
    expect(
      termsBetween(
        { season: "Fall", year: 2027 },
        { season: "Fall", year: 2026 },
      ),
    ).toBe(0);
  });
});
