"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Route-level error boundary. Next 15 mounts this when a child page throws.
 * Renders a plain-language fallback with a retry button and a route home —
 * we don't ship raw stack traces to end users, but the console gets the
 * original error for debugging.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the browser console + any log drain hooked into it.
    // eslint-disable-next-line no-console
    console.error("[dropcheck] page-level error:", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <Card className="border-[color:var(--color-verdict-significant)]/40">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <AlertTriangle className="mt-0.5 size-6 shrink-0 text-[color:var(--color-verdict-significant)]" />
            <div className="flex-1">
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                Something went sideways on this page.
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {error.message || "An unexpected error occurred while rendering."}
                {error.digest && (
                  <span className="ml-1 font-mono text-[11px] text-muted-foreground/70">
                    ({error.digest})
                  </span>
                )}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="lamp" size="sm" onClick={reset}>
                  <RotateCcw />
                  Retry
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/">Go home</Link>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
