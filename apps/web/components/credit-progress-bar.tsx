"use client";

import {
  GenericCodesBanner,
  type CodeNamespaceFields,
} from "@/components/generic-codes-banner";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Compact renderer for the `compute_degree_progress` tool result.
 * A stacked horizontal bar (satisfied / remaining) + a per-category
 * mini-list. Deliberately spare — the chat turn is where the story
 * lives; this is the "you're here" at-a-glance.
 */

export interface CreditProgressPayload extends CodeNamespaceFields {
  program_id: string;
  total_credits: number;
  remaining_credits?: number;
  by_category?: Array<{
    id: string;
    label?: string;
    credits_needed: number;
    credits_satisfied: number;
    still_owed?: unknown;
  }>;
}

export function CreditProgressBar({ payload }: { payload: CreditProgressPayload }) {
  const totalRequired =
    (payload.total_credits ?? 0) + (payload.remaining_credits ?? 0);
  const satisfied = payload.total_credits ?? 0;
  const remaining = payload.remaining_credits ?? Math.max(0, totalRequired - satisfied);
  const pct = totalRequired > 0 ? Math.round((satisfied / totalRequired) * 100) : 0;

  return (
    <Card className="mt-2">
      <CardContent className="p-4">
        <GenericCodesBanner payload={payload} />
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Degree progress · {payload.program_id}
            </p>
            <p className="mt-0.5 text-sm font-medium">
              {satisfied} of {totalRequired} credits{" "}
              <span className="text-muted-foreground">
                ({pct}%)
              </span>
            </p>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {remaining > 0 ? `${remaining} owed` : "on track"}
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={totalRequired || 100}
          aria-valuenow={satisfied}
          className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-lamp transition-all"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>

        {payload.by_category && payload.by_category.length > 0 && (
          <ul className="mt-4 space-y-1 text-xs">
            {payload.by_category.map((c) => {
              const catPct =
                c.credits_needed > 0
                  ? Math.round((c.credits_satisfied / c.credits_needed) * 100)
                  : 100;
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="truncate text-muted-foreground">
                    {c.label ?? c.id}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {c.credits_satisfied}/{c.credits_needed} · {catPct}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
