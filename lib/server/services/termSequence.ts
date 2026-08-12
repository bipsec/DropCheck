// Term sequencing helpers. Pure — no wall-clock reads, no Date.now().
// The scheduler in trackBuilder.ts passes an explicit starting term so
// plans are reproducible across runs and testable.

import type { Season, Term } from "@/lib/server/schemas/track";

// Fall → Spring next year → Summer same year → Fall next year.
// For the "generic" institution the calendar is: F, S, Su, F, S, Su, ...
export function nextTerm(t: Term): Term {
  switch (t.season) {
    case "Fall":
      return { season: "Spring", year: t.year + 1 };
    case "Spring":
      return { season: "Summer", year: t.year };
    case "Summer":
      return { season: "Fall", year: t.year };
  }
}

/** Count of terms from `a` to `b` inclusive of both endpoints (a ≤ b). */
export function termsBetween(a: Term, b: Term): number {
  const idx = (t: Term) => t.year * 3 + seasonIndex(t.season);
  return Math.max(0, idx(b) - idx(a) + 1);
}

/** Parse a stable label like "Fall 2026" → `Term`. Throws on garbage. */
export function parseTermLabel(label: string): Term {
  const m = label.trim().match(/^(Fall|Spring|Summer)\s+(\d{4})$/);
  if (!m) throw new Error(`Not a valid term label: ${JSON.stringify(label)}`);
  return { season: m[1] as Season, year: Number(m[2]) };
}

function seasonIndex(s: Season): number {
  return s === "Spring" ? 0 : s === "Summer" ? 1 : 2;
}
