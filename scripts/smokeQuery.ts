#!/usr/bin/env tsx
// Live end-to-end smoke test for the /query pipeline.
// Ported 1:1 from backend/scripts/smoke_query.py.
//
// Uploads the transcript, then invokes runQuery directly and prints
// the resulting synthesis + trace.
//
// Run from frontend/:
//   npm run script:smoke-query

import { AnthropicUnavailable } from "@/lib/server/agents/client";
import { extractProfile } from "@/lib/server/agents/extraction";
import { parsePdf } from "@/lib/server/services/pdf";
import {
  applyExtraction,
  matchNewCourses,
  patchStudent,
  recordTranscript,
  upsertFinance,
} from "@/lib/server/services/profile";
import { runQuery } from "@/lib/server/services/queryRun";
import { ensureSmokeStudent, makeTranscriptPdf, printTrace } from "./_smokeShared";

async function main(): Promise<number> {
  const studentId = await ensureSmokeStudent();
  console.log("session:", studentId);

  const pdfBytes = await makeTranscriptPdf();
  const parsed = await parsePdf(pdfBytes);
  let extraction: Awaited<ReturnType<typeof extractProfile>> | null = null;
  if (parsed.markdown.trim()) {
    try {
      extraction = await extractProfile(parsed.markdown);
    } catch (err) {
      if (!(err instanceof AnthropicUnavailable)) throw err;
    }
  }
  await recordTranscript(
    studentId,
    parsed.markdown,
    extraction ? (extraction as unknown as Record<string, unknown>) : null,
  );
  if (extraction) await applyExtraction(studentId, extraction);
  const matched = await matchNewCourses(studentId);
  const parsedCount = extraction ? extraction.courses.length : 0;

  // Backfill a few free-text fields to lift completeness past 80.
  await patchStudent(studentId, {
    future_plan: "grad school in machine learning",
    preferences: { prioritize: "graduate_fast" },
  });
  await upsertFinance(studentId, {
    employment_hours_week: 15,
    dependent_status: "independent",
  });

  console.log(`upload: parsed=${parsedCount} matched=${matched}`);
  console.log("");
  console.log("--- runQuery ---");

  const result = await runQuery(
    studentId,
    "I'm considering dropping this class. What does that do to my degree progress and aid?",
    "CS 310",
  );

  console.log(`conversation_id: ${result.conversation_id}`);
  console.log(`course_code:     ${result.course_code}`);
  console.log(`match_decision:  ${result.match_decision}`);
  console.log(`grounding_violations: ${result.grounding_violations.length}`);
  console.log("");
  printTrace(result.trace_events);

  console.log("");
  console.log("=== final ===");
  const final = result.final;
  const meta = (final.meta as Record<string, unknown>) ?? {};
  console.log(`headline:        ${final.headline ?? ""}`);
  console.log(`bottom_line:     ${final.bottomLine ?? final.bottom_line ?? ""}`);
  console.log(`confidence:      ${final.confidence ?? ""}`);
  console.log(`mode:            ${meta.mode ?? ""}  degraded=${meta.degraded ?? ""}`);
  if (meta.note) console.log(`note:            ${meta.note}`);

  console.log("");
  console.log("panels:");
  const panels = (final.panels as Array<Record<string, unknown>>) ?? [];
  for (const p of panels) {
    const impact = p.hasImpact || p.has_impact ? "!" : " ";
    const domain = String(p.domain ?? "").padEnd(10);
    console.log(`  [${impact}] ${domain} ${p.verdict ?? ""}`);
    const detail = String(p.detail ?? "");
    if (detail) console.log(`        ${detail.slice(0, 180)}`);
  }

  const sources = (final.sources as Array<Record<string, unknown>>) ?? [];
  if (sources.length > 0) {
    console.log("");
    console.log(`sources (${sources.length}):`);
    for (const s of sources.slice(0, 6)) {
      const agent = s.sourceAgent ?? s.source ?? "";
      const cit = s.sourceCitation ?? s.field ?? "";
      console.log(`  ${agent}: ${cit}`);
    }
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
