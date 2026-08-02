#!/usr/bin/env tsx
// Live end-to-end smoke test for the conversation-memory flow.
// Ported 1:1 from backend/scripts/smoke_followup.py.
//
// Uploads a transcript, fires an initial /query, then two follow-ups:
//   1. A clarification (should short-circuit through the clarification node).
//   2. A what-if (should re-run the full pipeline with an amended credit total).
//
// Also loads the conversation via getConversation and prints its shape.
//
// Run from frontend/:
//   npm run script:smoke-followup

import { AnthropicUnavailable } from "@/lib/server/agents/client";
import { extractProfile } from "@/lib/server/agents/extraction";
import { parsePdf } from "@/lib/server/services/pdf";
import {
  applyExtraction,
  matchNewCourses,
  recordTranscript,
} from "@/lib/server/services/profile";
import {
  getConversation,
  listConversations,
  runFollowup,
  runQuery,
  type QueryRunResult,
} from "@/lib/server/services/queryRun";
import { ensureSmokeStudent, makeTranscriptPdf, printTrace } from "./_smokeShared";

function printSummary(result: QueryRunResult, tag: string): void {
  console.log(`=== ${tag} ===`);
  console.log(`conversation_id:  ${result.conversation_id}`);
  console.log(`route_kind:       ${result.route_kind}`);
  console.log(`match_decision:   ${result.match_decision}`);
  console.log(`course_code:      ${result.course_code}`);
  if (result.hypothetical_drops.length > 0) {
    const codes = result.hypothetical_drops.map(
      (d) => d.course_code ?? d.course_hint ?? "?",
    );
    console.log(`hypothetical:     ${JSON.stringify(codes)}`);
  }
  console.log("trace:");
  printTrace(result.trace_events);
  const final = result.final ?? {};
  console.log(`headline:         ${final.headline ?? ""}`);
  const bottom = final.bottomLine ?? final.bottom_line;
  console.log(`bottom_line:      ${bottom ?? ""}`);
  if (result.clarification) {
    const answer = String(result.clarification.answer ?? "");
    console.log(`clarification:    ${answer.slice(0, 200)}`);
  }
  console.log("");
}

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
  console.log(`upload: parsed=${parsedCount} matched=${matched}`);

  // ---- Turn 1: initial query ----
  const turn1 = await runQuery(
    studentId,
    "Should I drop CS 310? I'm worried about my degree progress.",
    "CS 310",
  );
  printSummary(turn1, "TURN 1 — initial query");
  const convId = turn1.conversation_id;

  // ---- Turn 2: clarification ----
  const turn2 = await runFollowup(
    studentId,
    convId,
    "You mentioned SAP earlier — what does Satisfactory Academic Progress mean in plain terms?",
  );
  printSummary(turn2, "TURN 2 — clarification");

  // ---- Turn 3: what_if ----
  const turn3 = await runFollowup(
    studentId,
    convId,
    "What if I also drop MATH 201? I'm considering both.",
  );
  printSummary(turn3, "TURN 3 — what-if");

  // ---- Conversation reload ----
  const detail = await getConversation(studentId, convId);
  console.log("=== conversation reload ===");
  console.log(`turns: ${detail.turns.length}`);
  for (const t of detail.turns) {
    const role = String(t.role);
    let preview: string;
    if (role === "user") {
      preview = String(t.query ?? "").slice(0, 80);
    } else {
      const resp = (t.response as Record<string, unknown>) ?? {};
      preview = String(resp.headline ?? "(no headline)");
    }
    console.log(`  ${role.padEnd(10)} ${preview}`);
  }

  const convs = await listConversations(studentId);
  console.log("");
  console.log(`total conversations for this student: ${convs.length}`);

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
