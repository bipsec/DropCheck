// Psychology (BS) — 120-credit fixture over the in-memory demo catalog.

import type { ProgramRequirements } from "@/lib/server/schemas/track";

export const PSYCH_BS: ProgramRequirements = {
  program_id: "psych_bs",
  institution_id: "generic",
  total_credits_required: 120,
  categories: [
    {
      kind: "fixed",
      id: "psych_core",
      label: "Psychology core",
      credits_required: 19,
      courses: ["PSY 101", "PSY 220", "PSY 305", "PSY 340", "PSY 410"],
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
      id: "psych_electives",
      label: "Psychology electives",
      credits_required: 6,
      choose_from: {
        any_of: ["PSY 220", "PSY 305", "PSY 410"],
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
      credits_required: 3,
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
      credits_required: 83,
      choose_from: { tags: ["ge-writing", "ge-social", "ge-quantitative"] },
    },
  ],
};
