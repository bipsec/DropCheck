// Business Administration (BS) — 120-credit fixture over the in-memory
// demo catalog. Same schema shape as cs_bs; scheduler doesn't care which
// program it's building.

import type { ProgramRequirements } from "@/lib/server/schemas/track";

export const BUSINESS_BS: ProgramRequirements = {
  program_id: "business_bs",
  institution_id: "generic",
  total_credits_required: 120,
  categories: [
    {
      kind: "fixed",
      id: "bus_core",
      label: "Business core",
      credits_required: 15,
      courses: ["BUS 101", "BUS 210", "BUS 220", "BUS 310", "BUS 350"],
    },
    {
      kind: "fixed",
      id: "quant_core",
      label: "Quantitative requirement",
      credits_required: 3,
      courses: ["STAT 220"],
    },
    {
      kind: "choose_count",
      id: "bus_electives",
      label: "Business electives",
      credits_required: 6,
      choose_from: {
        // Any upper-division BUS course from the demo catalog that isn't
        // already required. Kept generic so future catalog additions widen
        // the pool automatically.
        any_of: ["BUS 220", "BUS 310", "BUS 350"],
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
    {
      kind: "choose_tag",
      id: "free_electives",
      label: "Free electives",
      credits_required: 84,
      choose_from: { tags: ["ge-writing", "ge-social", "ge-quantitative"] },
    },
  ],
};
