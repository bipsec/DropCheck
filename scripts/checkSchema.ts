#!/usr/bin/env tsx
// Pre-flight check: is the Supabase schema applied?
// Ported 1:1 from backend/scripts/check_schema.py.
//
// Usage (from frontend/):
//   npm run script:check-schema
//
// Exits non-zero if anything is missing.

import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv();

import { getSupabase } from "@/lib/server/supabase";

const TABLES = [
  "students",
  "student_finance",
  "course_catalog",
  "transcripts",
  "courses_taken",
  "conversations",
  "conversation_turns",
  "agent_traces",
] as const;

async function main(): Promise<number> {
  const sb = getSupabase();
  if (!sb) {
    console.log(
      "Supabase client is None — check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.",
    );
    return 2;
  }

  const missing: string[] = [];
  for (const t of TABLES) {
    const { error } = await sb.from(t).select("*").limit(1);
    if (error) {
      missing.push(t);
      console.log(`  -- ${t}`);
    } else {
      console.log(`  OK ${t}`);
    }
  }

  const zeroVec = new Array(1536).fill(0);
  const { error: rpcErr } = await sb.rpc("match_catalog_courses", {
    query_embedding: zeroVec,
    match_count: 1,
  });
  if (rpcErr) {
    missing.push("rpc:match_catalog_courses");
    console.log("  -- rpc: match_catalog_courses");
  } else {
    console.log("  OK rpc: match_catalog_courses");
  }

  if (missing.length > 0) {
    console.log("");
    console.log("Schema is not fully applied. Missing:");
    for (const m of missing) console.log(`  - ${m}`);
    console.log("");
    console.log(
      "Apply db/schema.sql via the Supabase SQL editor once, then re-run.",
    );
    return 1;
  }

  console.log("");
  console.log("Schema OK.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
