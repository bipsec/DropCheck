"use client";

import { BookOpen, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Renderer for the `get_course` tool result — a single course row from
 * the university-catalog MCP server (Purdue.io). Shows what the agent
 * saw when it looked the course up, including the low-confidence prereq
 * hint (which the system prompt requires the agent to caveat to the
 * student).
 */

export interface CoursePayload {
  course_code: string;
  title?: string;
  credits?: number | null;
  description?: string;
  prerequisites_hint?: string[];
  prerequisites_confidence?: string;
  terms_seen_historically?: string[];
  terms_offered_seasons?: string[];
  cache?: string;
  warning?: string;
}

export function CourseCard({ payload }: { payload: CoursePayload }) {
  const hasHints =
    (payload.prerequisites_hint?.length ?? 0) > 0;
  const historical = payload.terms_seen_historically ?? [];
  const seasons = payload.terms_offered_seasons ?? [];

  return (
    <Card className="mt-2">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Catalog · {payload.cache ?? "purdue.io"}
            </p>
            <p className="mt-0.5 truncate font-mono text-sm font-semibold">
              {payload.course_code}
              {payload.credits != null && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {payload.credits} cr
                </span>
              )}
            </p>
            {payload.title && (
              <p className="mt-0.5 text-sm text-foreground/90">
                {payload.title}
              </p>
            )}
          </div>
          <BookOpen className="size-4 text-muted-foreground" />
        </div>

        {payload.description && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {payload.description.length > 320
              ? payload.description.slice(0, 320) + "…"
              : payload.description}
          </p>
        )}

        {hasHints && (
          <div className="rounded-md border border-[color:var(--color-verdict-watch)]/30 bg-[color:var(--color-verdict-watch)]/5 px-3 py-2">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-verdict-watch)]">
              <AlertTriangle className="size-3" />
              Prereq hint · low confidence
            </div>
            <p className="mt-1 font-mono text-[11px] text-foreground/85">
              {payload.prerequisites_hint!.join(", ")}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Purdue.io only exposes prereqs in prose. Confirm with the
              student before treating this as authoritative.
            </p>
          </div>
        )}

        {(seasons.length > 0 || historical.length > 0) && (
          <div className="text-[10px] text-muted-foreground">
            <span className="font-mono uppercase tracking-wider">
              Historically offered:
            </span>{" "}
            {seasons.length > 0 ? seasons.join(" · ") : historical.slice(0, 6).join(", ")}
            <span className="ml-1 italic">(past runs, not a future promise)</span>
          </div>
        )}

        {payload.warning && (
          <p className="text-[11px] text-muted-foreground italic">
            {payload.warning}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
