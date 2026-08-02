"use client";

import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { Completeness } from "@/lib/api-types";
import { labelFor } from "@/lib/completeness-fields";
import { cn } from "@/lib/utils";

/**
 * Shows the profile-completeness percentage, threshold state, and a compact
 * missing-fields list. Three UI states:
 *   score < 50   → red band, "we can run analysis but answers will be shaky"
 *   50 ≤ x < 80  → amber band, "OK but you're not at the 80% threshold yet"
 *   x ≥ 80       → green band, "ready to run"
 * The threshold constants live server-side; we mirror the same tiers.
 */
export function CompletenessMeter({ completeness }: { completeness: Completeness }) {
  const { score, missing_fields, meets_80 } = completeness;
  const state = meets_80 ? "ready" : score >= 50 ? "partial" : "sparse";

  const barTint =
    state === "ready"
      ? "[&_[data-slot=indicator]]:bg-[color:var(--color-verdict-safe)]"
      : state === "partial"
      ? "[&_[data-slot=indicator]]:bg-[color:var(--color-verdict-watch)]"
      : "[&_[data-slot=indicator]]:bg-[color:var(--color-verdict-significant)]";

  const Icon =
    state === "ready" ? CheckCircle2 : state === "partial" ? Info : AlertTriangle;

  return (
    <Card className="border-lamp/30 bg-card">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <Icon
            className={cn(
              "size-5 shrink-0",
              state === "ready" && "text-[color:var(--color-verdict-safe)]",
              state === "partial" && "text-[color:var(--color-verdict-watch)]",
              state === "sparse" && "text-[color:var(--color-verdict-significant)]"
            )}
          />
          <div className="flex-1">
            <div className="flex flex-wrap items-baseline gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Profile completeness
              </p>
              <p className="font-display text-2xl font-semibold leading-none">
                {Math.round(score)}
                <span className="text-base text-muted-foreground">%</span>
              </p>
              {meets_80 ? (
                <span className="text-xs text-[color:var(--color-verdict-safe)]">
                  Ready for impact checks
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {80 - Math.round(score)} points from the 80% threshold
                </span>
              )}
            </div>
            <Progress
              value={score}
              className={cn(
                "mt-3 h-2",
                "[&>*]:transition-all",
                // Tailwind v4: Progress indicator uses `bg-lamp` by default;
                // override via a data-slot selector so the color tracks state.
                barTint
              )}
            />
            {missing_fields.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground">
                  Still missing ({missing_fields.length}):
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {missing_fields.map((slug) => (
                    <li
                      key={slug}
                      className="rounded-md border border-border/60 bg-muted/60 px-2 py-1 text-xs text-muted-foreground"
                    >
                      {labelFor(slug)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
