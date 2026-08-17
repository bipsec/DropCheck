// Hand-authored ProgramRequirements for a generic 120-credit BS in
// Computer Science, mapped onto the in-memory demo catalog in
// lib/server/data/catalog.ts.
//
// This is one fixture. Adding another program means dropping another
// file into this directory and registering it in ./index.ts. The
// schema is generic enough to hold any real program, but the
// scheduler only needs one program to prove the design works.

import type { ProgramRequirements } from "@/lib/server/schemas/track";

export const CS_BS: ProgramRequirements = {
  program_id: "cs_bs",
  institution_id: "generic",
  total_credits_required: 120,
  categories: [
    {
      kind: "fixed",
      id: "cs_core",
      label: "Computer Science core",
      credits_required: 20,
      // Six CS core + one shared prereq (MATH 210 is under math_core).
      courses: ["CS 101", "CS 201", "CS 301", "CS 340", "CS 402", "CS 410"],
    },
    {
      kind: "fixed",
      id: "math_core",
      label: "Math requirement",
      credits_required: 6,
      courses: ["MATH 210", "STAT 220"],
    },
    {
      kind: "choose_count",
      id: "cs_electives",
      label: "CS electives",
      // Two picks × 3 credits = 6, but the target here is credits, not
      // strict count; scheduler treats `credits_required` as the goal.
      credits_required: 6,
      choose_from: {
        // Any upper-division CS course from the demo catalog that isn't
        // already in cs_core. Kept generic so future catalog additions
        // widen the pool automatically.
        any_of: ["CS 340", "CS 402", "CS 410"],
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
      id: "ge_quantitative",
      label: "Quantitative breadth",
      credits_required: 3,
      choose_from: { tags: ["ge-quantitative"] },
    },
    // Free / open electives — modeled as a broad choose_tag against a
    // very common tag so a real catalog can fill it. In the demo
    // catalog this pool is thin, so tests that require unresolved
    // slots use this category deliberately.
    {
      kind: "choose_tag",
      id: "free_electives",
      label: "Free electives",
      credits_required: 76,
      choose_from: { tags: ["ge-writing", "ge-social", "ge-quantitative"] },
    },
  ],
};
