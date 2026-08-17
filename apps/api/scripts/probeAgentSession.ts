#!/usr/bin/env tsx
// Single-turn "hi" against a real Anthropic key. Verifies the SDK,
// MCP servers, allowedTools, and system prompt all wire up without
// blowing up on process start. Does NOT hit Supabase for the profile
// or catalog by default (the assistant just says hi).
//
// Requires ANTHROPIC_API_KEY in .env.local.
//
// Usage (from repo root):
//   npm run script:probe-agent

import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv();

import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildAgentOptions, captureSessionId } from "@/lib/server/agent/session";

async function main(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set — this probe requires it.");
    return 2;
  }

  const studentId = "probe-" + Date.now();
  console.log(`[probe] studentId=${studentId}`);

  const opts = await buildAgentOptions(studentId).catch((e) => {
    console.warn(
      "[probe] buildAgentOptions Supabase read failed (using no-resume):",
      String(e),
    );
    return null;
  });
  if (!opts) return 1;

  const captured = { current: null as string | null };
  const started = Date.now();

  const q = query({
    prompt: "Say hi in one short sentence — this is a wiring smoke test.",
    options: opts,
  });

  let assistantSaw = false;
  for await (const msg of q) {
    await captureSessionId(studentId, msg, captured).catch(() => undefined);
    const record = msg as Record<string, unknown>;
    if (record.type === "assistant") {
      const inner = (record.message as Record<string, unknown>) ?? {};
      const content = (inner.content as Array<Record<string, unknown>>) ?? [];
      for (const block of content) {
        if (block.type === "text") {
          assistantSaw = true;
          console.log(`[assistant] ${String(block.text).slice(0, 200)}`);
        }
      }
    } else if (record.type === "result") {
      console.log(
        `[result] session=${captured.current ?? "(none)"} elapsed=${
          ((Date.now() - started) / 1000).toFixed(1)
        }s`,
      );
    }
  }

  if (!assistantSaw) {
    console.error("[probe] no assistant text received.");
    return 1;
  }
  console.log("[probe] passed.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
