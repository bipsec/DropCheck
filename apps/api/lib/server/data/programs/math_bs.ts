// Mathematics (BS) — 120-credit fixture over the in-memory demo catalog.
// The math sequence chains Calc I → Calc II → Multivariable + Linear
// Algebra → upper-division (Real Analysis, Abstract Algebra, ODEs).

import type { ProgramRequirements } from "@/lib/server/schemas/track";

export const MATH_BS: ProgramRequirements = {
  program_id: "math_bs",
  institution_id: "generic",
  total_credits_required: 120,
  categories: [
    {
      kind: "fixed",
      id: "math_core",
      label: "Math core",
      // 4 + 4 + 3 + 3 = 14 credits: Calc I, Calc II, Discrete, Linear Algebra
      credits_required: 14,
      courses: ["MATH 120", "MATH 220", "MATH 210", "MATH 240"],
    },
    {
      kind: "fixed",
      id: "math_upper_core",
      label: "Upper-division core",
      // Multivariable (4) + Real Analysis (3) = 7
      credits_required: 7,
      courses: ["MATH 260", "MATH 340"],
    },
    {
      kind: "fixed",
      id: "stat_core",
      label: "Statistics requirement",
      credits_required: 3,
      courses: ["STAT 220"],
    },
    {
      kind: "choose_count",
      id: "math_electives",
      label: "Math electives",
      // Pick 2 from a pool of upper-division math courses. 6 credits.
      credits_required: 6,
      choose_from: {
        any_of: ["MATH 310", "MATH 360"],
        count: 2,
      },
    },
    {
      kind: "choose_tag",
      id: "ge_writing",
      label: "Writing requirement",
      credits_required: 3,
      choose_from: { tags: ["ge-writing"] },
    },
    {
      kind: "choose_tag",
      id: "ge_social",
      label: "Social science breadth",
      credits_required: 6,
      choose_from: { tags: ["ge-social"] },
    },
    {
      kind: "choose_tag",
      id: "free_electives",
      label: "Free electives",
      credits_required: 81,
      choose_from: { tags: ["ge-writing", "ge-social", "ge-quantitative"] },
    },
  ],
};
