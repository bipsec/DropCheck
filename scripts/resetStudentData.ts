#!/usr/bin/env tsx
// Wipe every student-scoped row so you can start clean.
//
// Truncates in dependency order:
//   advising_notes → session_state → student_waivers → student_transfers
//   → courses_taken → students
//
// Preserves `course_cache` (Purdue.io fetches survive) and leaves the
// schema itself intact. Idempotent — safe to re-run on an empty DB.
//
// Usage:
//   npm run script:reset-students             # wipe everything
//   npm run script:reset-students -- --dry    # count rows without deleting
//   npm run script:reset-students -- --student <uuid>   # only this student

import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv();

import { getSupabase } from "@/lib/server/supabase";

const CHILD_TABLES = [
  "advising_notes",
  "session_state",
  "student_waivers",
  "student_transfers",
  "courses_taken",
];

interface Args {
  dry: boolean;
  studentId: string | null;
}

function parseArgs(argv: string[]): Args {
  let dry = false;
  let studentId: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") dry = true;
    else if (a === "--student") studentId = argv[++i] ?? null;
  }
  return { dry, studentId };
}

async function main(): Promise<number> {
  const { dry, studentId } = parseArgs(process.argv.slice(2));
  const sb = getSupabase();
  if (!sb) {
    console.error("Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    return 2;
  }

  const scope = studentId ? `student ${studentId}` : "ALL students";
  const mode = dry ? "DRY RUN — counting only" : "WIPE";
  console.log(`[reset] ${mode} · ${scope}`);
  console.log("");

  // 1. Child tables (student_id-scoped).
  for (const table of CHILD_TABLES) {
    const countQ = studentId
      ? sb.from(table).select("*", { count: "exact", head: true }).eq("student_id", studentId)
      : sb.from(table).select("*", { count: "exact", head: true });
    const { count, error } = await countQ;
    if (error) {
      console.error(`  ${table.padEnd(20)} count failed: ${error.message}`);
      continue;
    }
    console.log(`  ${table.padEnd(20)} ${count ?? 0} rows`);
    if (dry || (count ?? 0) === 0) continue;

    // TRUNCATE isn't directly available via supabase-js — use a
    // "delete everything" pattern that PostgREST accepts.
    const delQ = studentId
      ? sb.from(table).delete().eq("student_id", studentId)
      : sb.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const { error: delErr } = await delQ;
    if (delErr) {
      console.error(`    delete failed: ${delErr.message}`);
    } else {
      console.log(`    ${count} rows deleted`);
    }
  }

  // 2. Parent students table (only after children are gone).
  const studentCountQ = studentId
    ? sb.from("students").select("*", { count: "exact", head: true }).eq("id", studentId)
    : sb.from("students").select("*", { count: "exact", head: true });
  const { count: sc, error: scErr } = await studentCountQ;
  if (scErr) {
    console.error(`  students             count failed: ${scErr.message}`);
    return 1;
  }
  console.log(`  ${"students".padEnd(20)} ${sc ?? 0} rows`);
  if (!dry && (sc ?? 0) > 0) {
    const delStuQ = studentId
      ? sb.from("students").delete().eq("id", studentId)
      : sb.from("students").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const { error } = await delStuQ;
    if (error) {
      console.error(`    delete failed: ${error.message}`);
      return 1;
    }
    console.log(`    ${sc} rows deleted`);
  }

  console.log("");
  console.log(dry ? "dry run complete — nothing changed." : "reset complete.");
  console.log("(course_cache preserved — Purdue.io fetches survive)");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
