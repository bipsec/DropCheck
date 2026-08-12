"use client";

import { PrereqDiagram } from "@/components/prereq-diagram";
import type { FinalDiagram } from "@/lib/api-types";

/**
 * Adapter that turns the `impact_of_dropping` tool result into the
 * `FinalDiagram` shape `<PrereqDiagram>` already knows how to render.
 * We don't have prereq info in this payload — just the drop candidate
 * and the transitive downstream — so the diagram renders as
 * dropped + downstream, no prereq column.
 */

export interface DropImpactPayload {
  course_code: string;
  now_blocked: string[];
  unblocked_by_removal?: string[];
  categoriesAtRisk?: string[];
}

export function DropImpactView({ payload }: { payload: DropImpactPayload }) {
  const diagram: FinalDiagram = {
    nodes: [
      { id: payload.course_code, label: payload.course_code, kind: "dropped" },
      ...payload.now_blocked.map((code) => ({
        id: code,
        label: code,
        kind: "downstream" as const,
      })),
    ],
    edges: payload.now_blocked.map((code) => ({
      from: payload.course_code,
      to: code,
    })),
  };

  return (
    <div className="mt-2 space-y-2">
      <PrereqDiagram diagram={diagram} />
      {(payload.categoriesAtRisk?.length ?? 0) > 0 && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-mono uppercase tracking-wider">
            Categories at risk:
          </span>{" "}
          {payload.categoriesAtRisk!.join(", ")}
        </p>
      )}
    </div>
  );
}
