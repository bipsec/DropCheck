// Embedding provider. Ported 1:1 from backend/app/services/embeddings.py.
//
// OpenAI text-embedding-3-small (1536 dims) matches the vector(1536)
// column in schema.sql. Anthropic doesn't ship embeddings, and we
// deliberately keep OpenAI here rather than switching to Voyage — that
// would require reindexing the 531-course catalog.

import OpenAI from "openai";
import { getSettings } from "@/lib/server/config";

export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 1536;
const BATCH_SIZE = 96;

export class EmbeddingUnavailable extends Error {
  constructor(message?: string) {
    super(
      message ??
        "OPENAI_API_KEY not set — add it to .env.local to enable catalog embeddings.",
    );
    this.name = "EmbeddingUnavailable";
  }
}

let cached: OpenAI | null | undefined;

function client(): OpenAI | null {
  if (cached !== undefined) return cached;
  const key = getSettings().openai_api_key;
  cached = key ? new OpenAI({ apiKey: key }) : null;
  return cached;
}

export function _resetEmbeddingsForTests(): void {
  cached = undefined;
}

export async function embedOne(text: string): Promise<number[]> {
  const [only] = await embedMany([text]);
  return only;
}

/**
 * Embed a batch in chunks. Order preserved — output[i] is the vector
 * for input[i]. Empty strings are substituted with a single space
 * because OpenAI 400s on empty input, and we want indices to stay
 * aligned with the caller's array.
 */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const c = client();
  if (!c) throw new EmbeddingUnavailable();

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    const cleaned = chunk.map((t) => (t.trim() ? t : " "));
    const response = await c.embeddings.create({
      model: EMBED_MODEL,
      input: cleaned,
    });
    for (const item of response.data) {
      out.push(item.embedding);
    }
  }
  return out;
}

/**
 * Exact embedding text a catalog row uses. Ingest + query paths must
 * call this to stay symmetric — otherwise cosine similarity gets
 * skewed by whitespace/case drift.
 */
export function catalogEmbeddingText(title: string, description: string | null | undefined): string {
  const desc = (description ?? "").trim();
  const t = title.trim();
  return desc ? `${t}. ${desc}` : t;
}
