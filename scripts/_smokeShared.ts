// Shared harness for the smoke scripts.
//
// - Loads .env.local + .env.
// - Makes a synthetic transcript PDF with pdf-lib.
// - Provides a synthetic "session" so the smoke scripts don't have to
//   go through HTTP; they call the service functions directly. That
//   matches Python's TestClient(app) semantics and keeps the scripts
//   single-process (no `npm run dev` required alongside).
//
// If you want a HTTP-flavored smoke instead, hit the running dev
// server via fetch — this file's helpers are still useful for the PDF.

import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv();

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSupabase } from "@/lib/server/supabase";

export const TRANSCRIPT_TEXT = `OFFICIAL ACADEMIC TRANSCRIPT

Student Name: Jane Ada Rivera
Program: Bachelor of Science, Computer Science
Expected Graduation: Spring 2027
Cumulative GPA: 3.42
Credits Completed: 68 / 120
Enrollment Status: Domestic

------------------------------------------------------
Fall 2023
  CS 101   Introduction to Computer Science    A-   3.0
  MATH 201 Calculus I                          B+   4.0
  ENG 101  College Writing                     A    3.0

Spring 2024
  CS 201   Data Structures                     B+   3.0
  MATH 210 Discrete Mathematics                A-   3.0
  BIO 500  Foundations of Biology              B    4.0

Fall 2024
  CS 301   Algorithms                          B    3.0
  CS 310   Computer Science Core II            A-   3.0
  PHIL 101 Introduction to Philosophy          A    3.0

Spring 2025
  CS 250   Intro to Programming                A    3.0
  STAT 201 Statistics I                        B+   3.0
  ART 101  Design Fundamentals                 A    3.0

------------------------------------------------------
Financial summary (per term)
  Tuition:                    $14,850
  Institutional grant:         $6,500
  Federal Pell grant:          $2,100
  Subsidized loan:             $3,500

End of transcript.
`;

export async function makeTranscriptPdf(text: string = TRANSCRIPT_TEXT): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const page = doc.addPage([612, 792]); // US Letter, points
  const size = 9;
  const lineHeight = 11;
  let y = 760;
  for (const line of text.split("\n")) {
    if (y < 40) {
      // Add a new page if we run out of vertical space.
      const next = doc.addPage([612, 792]);
      next.setFont(font);
      y = 760;
    }
    page.drawText(line, {
      x: 40,
      y,
      size,
      font,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
  }
  return doc.save();
}

/**
 * Mint an ephemeral student row in Supabase so the service functions have
 * something to attach to. Returns the student id.
 */
export async function ensureSmokeStudent(): Promise<string> {
  const sb = getSupabase();
  if (!sb) {
    throw new Error(
      "Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  const { data, error } = await sb
    .from("students")
    .insert({ session_id: `smoke-${Date.now()}` })
    .select("id");
  if (error || !data || data.length === 0) {
    throw new Error(
      `Failed to mint smoke student: ${error ? error.message : "empty response"}`,
    );
  }
  return String((data[0] as { id: string }).id);
}

export function printTrace(events: Array<Record<string, unknown>>): void {
  for (const ev of events) {
    const agent = String(ev.agent ?? "").padEnd(14);
    const status = String(ev.status ?? "").padEnd(8);
    const ms = String(ev.duration_ms ?? 0).padStart(5);
    console.log(`  ${agent} ${status} ${ms}ms  ${ev.summary ?? ""}`);
  }
}
