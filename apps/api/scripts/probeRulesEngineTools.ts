#!/usr/bin/env tsx
// Offline probe of the rules-engine MCP tools. Instantiates the tool
// wrappers WITHOUT the Agent SDK loop and invokes each with a
// hand-crafted input. Useful for quick sanity checks after a rules
// change and as documentation of the tool contract.
//
// Run from repo root:
//   npm run script:probe-rules
// (or:  npx tsx scripts/probeRulesEngineTools.ts)

import { CS_BS } from "@/lib/server/data/programs/cs_bs";
import { invokeRulesEngineTool } from "@/lib/server/mcp/rulesEngine";

async function main(): Promise<number> {
  const cases: Array<{
    label: string;
    tool: string;
    input: Record<string, unknown>;
  }> = [
    {
      label: "check_prerequisites — CS 301 with only CS 101 done",
      tool: "check_prerequisites",
      input: {
        course_code: "CS 301",
        prereqs: ["CS 201", "MATH 210"],
        completed_courses: ["CS 101"],
      },
    },
    {
      label: "compute_degree_progress — fresh cs_bs",
      tool: "compute_degree_progress",
      input: {
        program_requirements: CS_BS,
        completed_courses: [],
        waivers: [],
      },
    },
    {
      label: "impact_of_dropping — CS 201 with cs_core downstream",
      tool: "impact_of_dropping",
      input: {
        course_code: "CS 201",
        remaining_courses: [
          { course_code: "CS 301", prereqs: ["CS 201", "MATH 210"] },
          { course_code: "CS 340", prereqs: ["CS 201"] },
          { course_code: "CS 402", prereqs: ["CS 301", "CS 340"] },
          { course_code: "CS 410", prereqs: ["CS 201"] },
        ],
      },
    },
    {
      label: "build_track — fresh cs_bs",
      tool: "build_track",
      input: {
        program_requirements: CS_BS,
        completed_courses: [],
        waivers: [],
        max_credits_per_term: 15,
        start_term: { season: "Fall", year: 2026 },
      },
    },
  ];

  for (const c of cases) {
    console.log(`\n=== ${c.label} ===`);
    const res = await invokeRulesEngineTool(c.tool, c.input);
    console.log(
      JSON.stringify(res.structuredContent, null, 2).slice(0, 800),
    );
    if (res.isError) {
      console.log("(marked isError)");
      return 1;
    }
  }
  console.log("\nprobe passed.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
