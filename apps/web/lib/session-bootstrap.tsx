"use client";

import { useEffect, useRef, useState } from "react";

import { apiUrl } from "@/lib/api-config";

/**
 * Fires POST /api/session exactly once on mount so the anonymous
 * `dropcheck_sid` cookie is minted before the user tries to chat.
 * Silent by design — rendering nothing on success. On failure surfaces
 * a small unobtrusive banner in the corner so the developer sees the
 * problem, but doesn't gate the UI.
 */
export function SessionBootstrap() {
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // `credentials: "include"` is load-bearing, not boilerplate: the API
    // is on another origin, so the browser drops the session cookie
    // without it.
    fetch(apiUrl("/api/session"), { method: "POST", credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          let detail: string;
          try {
            const body = await r.json();
            detail = String(body.detail ?? `HTTP ${r.status}`);
          } catch {
            detail = `HTTP ${r.status}`;
          }
          throw new Error(detail);
        }
      })
      .catch((err) => {
        console.warn("session bootstrap failed", err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (!error) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-border bg-card px-4 py-2 text-xs text-muted-foreground shadow-md"
    >
      Session couldn&apos;t start:{" "}
      <code className="font-mono">{error}</code>
    </div>
  );
}
