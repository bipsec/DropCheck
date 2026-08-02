// PDF → markdown extraction with a Claude-vision OCR fallback.
// Ported from backend/app/services/pdf.py, but the OCR strategy is
// different from Python: instead of pytesseract we render each page
// through unpdf (pdfjs + @napi-rs/canvas) into a PNG and hand it to
// Claude vision. That keeps the tool set Anthropic-only for OCR.
//
// Strategy:
//   1. unpdf's `extractText({mergePages:true})` — happy path for
//      text-native PDFs.
//   2. If the extracted text is short (< OCR_TEXT_THRESHOLD chars) we
//      suspect a scanned PDF and render every page, sending the images
//      to Claude vision to transcribe verbatim.
//   3. If Claude isn't configured or rendering fails, return whatever
//      the text pass produced. Never let a bad PDF stop the request.

import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { getClient } from "@/lib/server/agents/client";

export const OCR_TEXT_THRESHOLD = 400;
const OCR_SCALE = 2.2; // roughly 220 DPI at pdfjs's 72dpi baseline
const OCR_VISION_MODEL = "claude-haiku-4-5"; // Haiku is enough for verbatim transcription
const MAX_OCR_PAGES = 8; // hard cap so a huge PDF can't blow out the token budget

export interface ParsedPdf {
  markdown: string;
  method: "text" | "ocr" | "text+ocr" | "empty";
  pageCount: number;
  ocrAvailable: boolean;
}

export async function parsePdf(data: Uint8Array): Promise<ParsedPdf> {
  const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);

  const textResult = await tryExtractText(buffer);
  const pageCount = textResult.pageCount;
  const mdText = textResult.text;

  if (mdText.trim().length >= OCR_TEXT_THRESHOLD) {
    return {
      markdown: mdText,
      method: "text",
      pageCount,
      ocrAvailable: true, // Claude-based OCR is available conceptually; we just didn't need it.
    };
  }

  const ocr = await tryOcrPages(buffer, pageCount);

  if (!ocr.ok) {
    const method = mdText.trim() ? "text" : "empty";
    return { markdown: mdText, method, pageCount, ocrAvailable: false };
  }

  const textStripped = mdText.trim();
  const ocrStripped = ocr.text.trim();

  if (textStripped && ocrStripped) {
    return {
      markdown: `${textStripped}\n\n---\n\n${ocrStripped}`,
      method: "text+ocr",
      pageCount,
      ocrAvailable: true,
    };
  }

  const combined = ocrStripped || mdText;
  const method = ocrStripped ? "ocr" : "text";
  return { markdown: combined, method, pageCount, ocrAvailable: true };
}

async function tryExtractText(
  data: Uint8Array,
): Promise<{ text: string; pageCount: number }> {
  try {
    const doc = await getDocumentProxy(data);
    // `mergePages: true` narrows `result.text` to `string`.
    const result = await extractText(doc, { mergePages: true });
    return { text: result.text, pageCount: result.totalPages };
  } catch (err) {
    console.warn("[pdf] extractText failed:", err instanceof Error ? err.message : err);
    return { text: "", pageCount: 0 };
  }
}

async function tryOcrPages(
  data: Uint8Array,
  pageCount: number,
): Promise<{ ok: boolean; text: string }> {
  const client = getClient();
  if (!client) {
    console.warn(
      "[pdf] OCR fallback unavailable — ANTHROPIC_API_KEY not set. " +
        "Returning text-layer result only.",
    );
    return { ok: false, text: "" };
  }

  // Cap pages so a huge scanned PDF can't send hundreds of images.
  const limit = Math.min(pageCount, MAX_OCR_PAGES);
  if (limit === 0) return { ok: false, text: "" };

  const chunks: string[] = [];
  for (let i = 1; i <= limit; i++) {
    try {
      const png = await renderPageAsImage(data, i, { scale: OCR_SCALE });
      const base64 = Buffer.from(png).toString("base64");
      const response = await client.messages.create({
        model: OCR_VISION_MODEL,
        max_tokens: 3000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: base64,
                },
              },
              {
                type: "text",
                text:
                  "Transcribe this transcript page verbatim as plain text. " +
                  "Preserve columns, course codes, grades, and semester labels. " +
                  "Do not paraphrase or summarize. If a field is illegible, " +
                  "write [illegible] in place of it.",
              },
            ],
          },
        ],
      });
      const pageText = response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("")
        .trim();
      if (pageText) {
        chunks.push(`## Page ${i}\n\n${pageText}`);
      }
    } catch (err) {
      console.warn(
        `[pdf] OCR failed for page ${i}:`,
        err instanceof Error ? err.message : err,
      );
      // One bad page shouldn't kill the whole OCR pass.
      continue;
    }
  }

  return { ok: true, text: chunks.join("\n\n") };
}
