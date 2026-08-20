"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Namespace disclosure for archetype-derived course codes.
 *
 * The four program fixtures use invented codes (CS 101, MATH 210) while
 * the catalog serves real ones (CS 18000). A plan built from a fixture
 * looks exactly like a registrable plan, and in live testing the advisor
 * disclosed the difference only *after* presenting the plan — by which
 * point the student had already read it as actionable.
 *
 * So the tool payloads carry `code_namespace` and this banner renders it
 * unconditionally. The model can still bury the caveat in prose; it
 * can't suppress this.
 */

export interface CodeNamespaceFields {
  code_namespace?: "generic" | "institution" | string;
  advisory?: string;
}

export function GenericCodesBanner({
  payload,
}: {
  payload: CodeNamespaceFields;
}) {
  if (payload.code_namespace !== "generic") return null;

  return (
    <div
      role="note"
      data-testid="generic-codes-banner"
      className="mb-3 rounded-md border border-[color:var(--color-verdict-watch)]/40 bg-[color:var(--color-verdict-watch)]/5 px-3 py-2"
    >
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-verdict-watch)]">
        <AlertTriangle className="size-3" />
        Generic course codes — not registrable
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {payload.advisory ??
          "These are generic archetype course codes, not real institution " +
            "course codes. Use this for shape and sequencing only."}
      </p>
    </div>
  );
}
