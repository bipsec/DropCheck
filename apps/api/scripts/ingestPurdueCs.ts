#!/usr/bin/env tsx
// One-time batch fetch of every Purdue CS course into the Supabase
// `course_cache` table. Idempotent — safe to re-run; upsert on
// course_code refreshes `fetched_at`.
//
// Usage (from repo root):
//   npm run script:ingest-purdue-cs
//   npm run script:ingest-purdue-cs -- --subject MATH
//   npm run script:ingest-purdue-cs -- --detail
//
// Flags:
//   --subject ABBR   Which subject to fetch. Default: CS.
//   --detail         After the bulk list, fetch per-course detail
//                    (expensive; resolves terms_seen_historically).

import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv();

import {
  fetchCourseDetail,
  isPurdueError,
  listSubjectCourses,
  type PurdueCourseNormalized,
} from "@/lib/server/services/purdueClient";
import { writeCacheBatch } from "@/lib/server/services/courseCache";
import { getSupabase } from "@/lib/server/supabase";

interface Args {
  subject: string;
  detail: boolean;
}

function parseArgs(argv: string[]): Args {
  let subject = "CS";
  let detail = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--subject") subject = argv[++i]!;
    else if (a === "--detail") detail = true;
  }
  return { subject, detail };
}

async function main(): Promise<number> {
  const { subject, detail } = parseArgs(process.argv.slice(2));
  const abbr = subject.trim().toUpperCase();
  console.log(`Fetching Purdue ${abbr} subject listing...`);

  if (!getSupabase()) {
    console.error(
      "Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
    return 2;
  }

  const started = Date.now();
  const list = await listSubjectCourses(abbr);
  if (isPurdueError(list)) {
    console.error(`Purdue list failed: ${list.error} — ${list.detail}`);
    return 1;
  }
  console.log(`  fetched ${list.length} distinct ${abbr} courses`);

  let final: PurdueCourseNormalized[] = list;
  if (detail) {
    console.log("  --detail set: fetching per-course detail...");
    const detailed: PurdueCourseNormalized[] = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const d = await fetchCourseDetail(c.subject, c.number);
      if (isPurdueError(d)) {
        // Fall through to the bulk row; log the miss.
        console.warn(
          `    ${c.course_code}: ${d.error} (${d.detail}) — using bulk row`,
        );
        detailed.push(c);
      } else {
        detailed.push(d);
      }
      if ((i + 1) % 25 === 0) {
        console.log(`    detail: ${i + 1}/${list.length}`);
      }
    }
    final = detailed;
  }

  console.log(`Writing ${final.length} rows to course_cache...`);
  await writeCacheBatch(final);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Done in ${elapsed}s.`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
