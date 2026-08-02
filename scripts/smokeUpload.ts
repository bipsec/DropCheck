#!/usr/bin/env tsx
// Live smoke test for the transcript upload pipeline.
// Ported 1:1 from backend/scripts/smoke_upload.py.
//
// Generates a synthetic transcript PDF in memory, runs the full parse →
// extract → apply → match pipeline directly against the services (no
// HTTP server needed), and prints what came out.
//
// Run from frontend/:
//   npm run script:smoke-upload

import { AnthropicUnavailable } from "@/lib/server/agents/client";
import { extractProfile } from "@/lib/server/agents/extraction";
import { parsePdf } from "@/lib/server/services/pdf";
import {
  applyExtraction,
  completenessFor,
  getProfile,
  matchNewCourses,
  recordTranscript,
} from "@/lib/server/services/profile";
import { ensureSmokeStudent, makeTranscriptPdf } from "./_smokeShared";

async function main(): Promise<number> {
  const studentId = await ensureSmokeStudent();
  console.log("session:", studentId);

  const pdfBytes = await makeTranscriptPdf();
  console.log(`generated ${pdfBytes.length} byte PDF`);

  const parsed = await parsePdf(pdfBytes);

  let extraction: Awaited<ReturnType<typeof extractProfile>> | null = null;
  let warning: string | null = null;
  if (parsed.markdown.trim()) {
    try {
      extraction = await extractProfile(parsed.markdown);
    } catch (err) {
      if (err instanceof AnthropicUnavailable) {
        warning = `Extraction skipped: ${err.message}`;
      } else {
        throw err;
      }
    }
  } else {
    warning = "PDF appeared empty.";
  }

  const transcriptId = await recordTranscript(
    studentId,
    parsed.markdown,
    extraction ? (extraction as unknown as Record<string, unknown>) : null,
  );
  if (extraction) await applyExtraction(studentId, extraction);
  const matched = await matchNewCourses(studentId);
  const completeness = await completenessFor(studentId);

  console.log("");
  console.log("=== upload result ===");
  console.log(`transcript_id:     ${transcriptId}`);
  console.log(`parse_method:      ${parsed.method}`);
  console.log(`ocr_available:     ${parsed.ocrAvailable}`);
  console.log(`courses_parsed:    ${extraction ? extraction.courses.length : 0}`);
  console.log(`courses_matched:   ${matched}`);
  console.log(
    `completeness:      ${completeness.score}%  meets_80=${completeness.meets_80}`,
  );
  if (completeness.missing_fields.length > 0) {
    console.log(`missing:           ${completeness.missing_fields.join(", ")}`);
  }
  if (warning) console.log(`warning:           ${warning}`);

  const profile = await getProfile(studentId);
  console.log("");
  console.log("=== profile after upload ===");
  const stu = profile.student as Record<string, unknown>;
  console.log(`name:              ${stu.name ?? ""}`);
  console.log(`program:           ${stu.program ?? ""}`);
  console.log(`gpa:               ${stu.gpa ?? ""}`);
  console.log(`total_credits:     ${stu.total_credits_completed ?? ""}`);
  console.log(`international:     ${stu.international ?? ""}`);
  const fin = (profile.finance as Record<string, unknown>) ?? {};
  console.log(`tuition_per_term:  ${fin.tuition_per_term ?? ""}`);
  console.log(`aid_amount:        ${fin.current_aid_amount ?? ""}`);
  console.log(`aid_types:         ${JSON.stringify(fin.aid_types ?? [])}`);

  const courses = profile.courses as Array<Record<string, unknown>>;
  console.log("");
  console.log(`courses (${courses.length}):`);
  for (const c of courses) {
    const matched = c.catalog_course_id ? "MATCH" : "-----";
    const conf = Number(c.match_confidence ?? 0).toFixed(2);
    const code = String(c.course_code ?? "").padEnd(10);
    const title = String(c.title ?? "").slice(0, 40).padEnd(40);
    console.log(
      `  ${matched} ${code} ${title} grade=${c.grade ?? "-"} credits=${c.credits ?? "-"} conf=${conf}`,
    );
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
