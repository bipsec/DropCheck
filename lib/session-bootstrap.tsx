"use client";

import { useEffect, useRef, useState } from "react";
import { createSession } from "./api";

/**
 * Client-side session bootstrap.
 *
 * Fires POST /session exactly once on mount so the backend has a
 * `dropcheck_sid` cookie for every subsequent request. Runs on the client
 * (not during SSR) because cookies are per-browser and we want each visitor
 * to get their own.
 *
 * Silent by design: renders nothing. A failure surfaces in the UI when a
 * downstream call misses its session — the individual page's toast handles
 * that.
 */
export function SessionBootstrap() {
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    createSession().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("session bootstrap failed", err);
      setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  if (!error) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 rounded-md border border-border bg-card px-4 py-2 text-xs text-muted-foreground shadow-md"
    >
      Session couldn&apos;t start — backend at{" "}
      <code className="font-mono">/api/session</code> unreachable.
    </div>
  );
}
