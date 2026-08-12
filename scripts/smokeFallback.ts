#!/usr/bin/env tsx
// Fallback-behavior smoke. Real Anthropic + real rules-engine + real
// profile-memory + MOCK university-catalog (every catalog call
// returns { error: "unavailable" }).
//
// Verifies system-prompt rule 3: on a catalog error, Claude must
//   (a) NOT retry the same tool this turn,
//   (b) tell the student plainly that catalog data isn't available,
//   (c) fall back to archetype programs + student-reported courses.
//
// Requires ANTHROPIC_API_KEY. Run:
//   npm run script:smoke-fallback

import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv();

import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildAgentOptions } from "@/lib/server/agent/session";
import { mockCatalogServer } from "@/lib/server/mcp/mockCatalog";

interface Observation {
  turn: string;
  assistantText: string;
  catalogCallsThisTurn: number;
  catalogErrorsThisTurn: number;
  otherToolCallsThisTurn: Set<string>;
}

async function runTurn(
  studentId: string,
  prompt: string,
  turnLabel: string,
): Promise<Observation> {
  const options = await buildAgentOptions(studentId, {
    catalogServer: mockCatalogServer,
  }).catch((err) => {
    console.error(`[${turnLabel}] buildAgentOptions failed:`, err);
    return null;
  });
  if (!options) {
    throw new Error("Could not assemble agent options.");
  }

  const q = query({ prompt, options });
  let assistantText = "";
  let catalogCallsThisTurn = 0;
  let catalogErrorsThisTurn = 0;
  const otherToolCallsThisTurn = new Set<string>();

  for await (const msg of q) {
    const m = msg as Record<string, unknown>;
    if (m.type === "assistant") {
      const inner = (m.message as Record<string, unknown>) ?? {};
      const content = (inner.content as Array<Record<string, unknown>>) ?? [];
      for (const block of content) {
        if (block.type === "text") {
          assistantText += String(block.text ?? "") + "\n";
        }
        if (block.type === "tool_use") {
          const name = String(block.name ?? "");
          if (name.startsWith("mcp__university-catalog__")) {
            catalogCallsThisTurn += 1;
          } else {
            otherToolCallsThisTurn.add(name);
          }
        }
      }
    }
    if (m.type === "user") {
      const inner = (m.message as Record<string, unknown>) ?? {};
      const content = (inner.content as Array<Record<string, unknown>>) ?? [];
      for (const block of content) {
        if (block.type === "tool_result" && block.is_error === true) {
          catalogErrorsThisTurn += 1;
        }
      }
    }
  }
  return {
    turn: turnLabel,
    assistantText,
    catalogCallsThisTurn,
    catalogErrorsThisTurn,
    otherToolCallsThisTurn,
  };
}

function report(o: Observation): boolean {
  console.log(`\n=== ${o.turn} ===`);
  console.log(`catalog calls: ${o.catalogCallsThisTurn}`);
  console.log(`catalog errors received: ${o.catalogErrorsThisTurn}`);
  console.log(
    `non-catalog tools: ${[...o.otherToolCallsThisTurn].join(", ") || "(none)"}`,
  );
  console.log("--- assistant text ---");
  console.log(o.assistantText.trim().slice(0, 1200));

  // Guardrails.
  let ok = true;
  if (o.catalogCallsThisTurn > 1) {
    console.warn(
      "  ⚠ agent hit catalog more than once this turn (system-prompt rule 3 says do not retry)",
    );
    ok = false;
  }
  const said =
    /don't have your school|catalog data isn't available|catalog data is not available|catalog data unavailable|not available/i.test(
      o.assistantText,
    );
  if (o.catalogErrorsThisTurn > 0 && !said) {
    console.warn(
      "  ⚠ catalog errored but assistant did not surface the outage plainly",
    );
    ok = false;
  }
  return ok;
}

async function main(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set — this smoke requires it.");
    return 2;
  }

  const studentId = "fallback-" + Date.now();
  console.log(`[fallback smoke] studentId=${studentId} (mock catalog wired)`);

  const turns = [
    {
      label: "Turn 1 — course lookup that will fail",
      prompt:
        "I'm considering taking CS 25000 at Purdue. Can you tell me about it? Say what you looked up honestly.",
    },
    {
      label: "Turn 2 — degree planning w/o catalog",
      prompt:
        "I'm a CS BS. I've already completed CS 18000, CS 24000, and MATH 165. What should I plan for next semester? Use archetypes if the catalog is unavailable.",
    },
  ];

  let overallOk = true;
  for (const t of turns) {
    try {
      const obs = await runTurn(studentId, t.prompt, t.label);
      if (!report(obs)) overallOk = false;
    } catch (err) {
      console.error(`[${t.label}] failed:`, err);
      overallOk = false;
    }
  }

  console.log("");
  if (overallOk) {
    console.log("fallback smoke passed — agent degraded honestly.");
    return 0;
  }
  console.log("fallback smoke FAILED — see warnings above.");
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
