// POST /api/profile/upload — multipart PDF ingest.
// Runs the full parse → extract → apply → match pipeline. Ported from
// backend/app/api/routes/profile.py.

import { extractProfile } from "@/lib/server/agents/extraction";
import { AnthropicUnavailable } from "@/lib/server/agents/client";
import { requireStudent } from "@/lib/server/cookies";
import { errorResponse, jsonResponse, withErrorHandling } from "@/lib/server/http";
import { parsePdf } from "@/lib/server/services/pdf";
import {
  applyExtraction,
  completenessFor,
  matchNewCourses,
  ProfileError,
  recordTranscript,
} from "@/lib/server/services/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// PDF parse + Opus extraction + matcher pass can take ~30s combined.
export const maxDuration = 120;

const MAX_PDF_BYTES = 15 * 1024 * 1024;

const OK_TYPES = new Set(["application/pdf", "application/octet-stream"]);

export const POST = withErrorHandling(async (req: Request) => {
  const student = await requireStudent(req);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    console.warn("[profile/upload] rejected: missing `file` field", {
      keys: [...form.keys()],
    });
    return errorResponse(400, "Missing `file` in multipart body.");
  }
  const contentType = (file.type ?? "").toLowerCase();
  const filename = (file.name ?? "").toLowerCase();
  // Accept by content-type OR by .pdf extension — some drag/drop paths
  // (especially Windows/Firefox) send an empty content-type.
  const looksLikePdf = OK_TYPES.has(contentType) || filename.endsWith(".pdf");
  if (!looksLikePdf) {
    console.warn("[profile/upload] rejected: not a PDF", {
      contentType,
      filename,
      size: file.size,
    });
    return errorResponse(
      400,
      `Expected a PDF file; got content-type ${JSON.stringify(contentType)} and filename ${JSON.stringify(filename)}.`,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) {
    console.warn("[profile/upload] rejected: empty file", { filename });
    return errorResponse(400, "Empty file.");
  }
  if (bytes.length > MAX_PDF_BYTES) {
    return errorResponse(
      413,
      `PDF exceeds ${Math.floor(MAX_PDF_BYTES / (1024 * 1024))} MB limit.`,
    );
  }

  const parsed = await parsePdf(bytes);
  let warning: string | null = null;

  let extraction: Awaited<ReturnType<typeof extractProfile>> | null = null;
  if (parsed.markdown.trim()) {
    try {
      extraction = await extractProfile(parsed.markdown);
    } catch (err) {
      if (err instanceof AnthropicUnavailable) {
        warning = `Extraction skipped: ${err.message}. You can still edit the profile manually.`;
      } else {
        throw err;
      }
    }
  } else {
    warning = "PDF appeared empty. Fill your profile manually.";
  }

  let transcriptId: string;
  try {
    transcriptId = await recordTranscript(
      student.id!,
      parsed.markdown,
      extraction ? (extraction as unknown as Record<string, unknown>) : null,
    );
  } catch (err) {
    if (err instanceof ProfileError) return errorResponse(503, err.message);
    throw err;
  }

  if (extraction) {
    try {
      await applyExtraction(student.id!, extraction);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[profile/upload] applyExtraction failed:", msg);
      warning = `${warning ?? ""} apply_extraction failed: ${msg}`.trim();
    }
  }

  let matched = 0;
  try {
    matched = await matchNewCourses(student.id!);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[profile/upload] matcher pass failed:", msg);
    warning = `${warning ?? ""} Matcher pass failed: ${msg}`.trim();
  }

  const completeness = await completenessFor(student.id!);

  return jsonResponse({
    student_id: student.id,
    transcript_id: transcriptId,
    parse_method: parsed.method,
    ocr_available: parsed.ocrAvailable,
    courses_parsed: extraction ? extraction.courses.length : 0,
    courses_matched: matched,
    completeness,
    warning: warning || null,
  });
});
