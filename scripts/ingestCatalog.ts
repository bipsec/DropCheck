#!/usr/bin/env tsx
// Ingest a JSON catalog file into course_catalog with embeddings.
// Ported 1:1 from backend/scripts/ingest_catalog.py.
//
// Usage (from frontend/):
//   npm run script:ingest-catalog -- data/sample_catalog.json
//   npm run script:ingest-catalog -- --limit 50 data/sample_catalog.json
//
// Idempotent (upserts on course_code). Prints per-batch progress.

import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { CatalogUploadIn } from "@/lib/server/schemas/catalog";
import { upsertCatalog } from "@/lib/server/services/catalog";

// Load env from .env.local first (dev/local shape), fall back to .env.
loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv();

const DEFAULT_BATCH = 50;

function parseArgs(argv: string[]): { file: string; limit: number | null; batch: number } {
  let file: string | undefined;
  let limit: number | null = null;
  let batch = DEFAULT_BATCH;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") {
      limit = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(limit)) throw new Error("--limit expects a number");
    } else if (a === "--batch") {
      batch = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(batch)) throw new Error("--batch expects a number");
    } else if (!a.startsWith("-")) {
      file = a;
    }
  }
  if (!file) {
    throw new Error(
      "Usage: npm run script:ingest-catalog -- <path/to/catalog.json> [--limit N] [--batch N]",
    );
  }
  return { file, limit, batch };
}

async function main(): Promise<number> {
  const { file, limit, batch } = parseArgs(process.argv.slice(2));
  const abs = path.resolve(process.cwd(), file);
  const body = JSON.parse(fs.readFileSync(abs, "utf8"));
  const parsed = CatalogUploadIn.parse(body);

  const courses = limit !== null ? parsed.courses.slice(0, limit) : parsed.courses;
  const total = courses.length;
  console.log(`parsed ${total} rows from ${file}`);

  const started = Date.now();
  let ingested = 0;
  for (let i = 0; i < total; i += batch) {
    const chunk = courses.slice(i, i + batch);
    const result = await upsertCatalog(chunk);
    ingested += result.count;
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `  ${String(i + chunk.length).padStart(4)}/${total}  ` +
        `(+${result.count} rows, ${elapsed}s elapsed)`,
    );
  }
  const total_s = ((Date.now() - started) / 1000).toFixed(1);
  console.log("");
  console.log(`done: ${ingested} rows upserted in ${total_s}s`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
