// Route-handler helpers: JSON serialization, uniform error responses.
//
// Every route in app/api/* is wrapped in `withErrorHandling(...)` so a
// thrown `HttpError` becomes a proper HTTP Response with `{detail: ...}`
// (matching the FastAPI shape the frontend already consumes). Anything
// else falls through as a 500 with the message stringified.

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "@/lib/server/cookies";
import { EmbeddingUnavailable } from "@/lib/server/services/embeddings";
import { CatalogError } from "@/lib/server/services/catalog";
import { ProfileError } from "@/lib/server/services/profile";
import { QueryError } from "@/lib/server/services/queryRun";
import { AnthropicUnavailable } from "@/lib/server/agents/client";

export function jsonResponse(
  body: unknown,
  status: number = 200,
  extraHeaders?: Record<string, string>,
): NextResponse {
  const headers = new Headers({ "content-type": "application/json" });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }
  return new NextResponse(JSON.stringify(body), { status, headers });
}

export function errorResponse(status: number, detail: string): NextResponse {
  return jsonResponse({ detail }, status);
}

/**
 * Wrap an async route handler and translate known error types into the
 * HTTP status codes the frontend expects (mirrors FastAPI's behavior).
 * Unknown errors → 500 with the message.
 */
export function withErrorHandling<T extends unknown[]>(
  fn: (...args: T) => Promise<NextResponse | Response>,
): (...args: T) => Promise<NextResponse | Response> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.message);
      if (err instanceof ZodError) {
        // Body validation failure. FastAPI would return 422 here, but the
        // frontend treats 400 as "user-visible fixable" — keep parity.
        return errorResponse(400, err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      }
      if (err instanceof CatalogError) return errorResponse(503, err.message);
      if (err instanceof EmbeddingUnavailable) return errorResponse(503, err.message);
      if (err instanceof ProfileError) return errorResponse(500, err.message);
      if (err instanceof QueryError) return errorResponse(400, err.message);
      if (err instanceof AnthropicUnavailable) return errorResponse(503, err.message);
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] unhandled error:", err);
      return errorResponse(500, message);
    }
  };
}
