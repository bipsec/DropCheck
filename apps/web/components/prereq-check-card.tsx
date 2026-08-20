"use client";

import { AlertTriangle, Check, ShieldCheck, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Renderer for the `check_prerequisites` tool result.
 *
 * This tool takes the prereq list as an *input* and returns set
 * arithmetic over it, which made it a laundering channel: a prose-derived
 * catalog hint went in and a deterministic-looking `satisfied: true` came
 * out, which the advisor then cited as verification. It only ever
 * verified the arithmetic.
 *
 * The payload now declares its provenance, and this card renders it next
 * to the verdict — so "not verified" is on screen even when the prose
 * says otherwise. `prereqs_evaluated` is shown deliberately: the student
 * can only correct a claim they can see.
 */

export interface PrereqCheckPayload {
  course_code: string;
  satisfied: boolean;
  missing?: string[];
  prereqs_evaluated?: string[];
  prereq_source?: string;
  confidence?: string;
  verified?: boolean;
  caveat?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  catalog_hint: "catalog prose hint",
  student_asserted: "student-confirmed",
  archetype: "program fixture",
  assumed: "model inference",
};

export function PrereqCheckCard({ payload }: { payload: PrereqCheckPayload }) {
  const missing = payload.missing ?? [];
  const evaluated = payload.prereqs_evaluated ?? [];
  const verified = payload.verified === true;
  const sourceLabel = payload.prereq_source
    ? (SOURCE_LABELS[payload.prereq_source] ?? payload.prereq_source)
    : "source not declared";

  return (
    <Card className="mt-2">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Prereq check
            </p>
            <p className="mt-0.5 truncate font-mono text-sm font-semibold">
              {payload.course_code}
            </p>
          </div>
          <span
            data-testid="prereq-verdict"
            className={
              payload.satisfied
                ? "flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-verdict-safe)]"
                : "flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-verdict-watch)]"
            }
          >
            {payload.satisfied ? (
              <Check className="size-3" />
            ) : (
              <X className="size-3" />
            )}
            {payload.satisfied ? "met as given" : "not met"}
          </span>
        </div>

        {evaluated.length > 0 && (
          <p className="font-mono text-[11px] text-foreground/85">
            <span className="text-muted-foreground">Evaluated:</span>{" "}
            {evaluated.join(", ")}
          </p>
        )}

        {missing.length > 0 && (
          <p className="font-mono text-[11px] text-[color:var(--color-verdict-watch)]">
            <span className="text-muted-foreground">Missing:</span>{" "}
            {missing.join(", ")}
          </p>
        )}

        <div
          data-testid="prereq-provenance"
          className={
            verified
              ? "rounded-md border border-[color:var(--color-verdict-safe)]/30 bg-[color:var(--color-verdict-safe)]/5 px-3 py-2"
              : "rounded-md border border-[color:var(--color-verdict-watch)]/30 bg-[color:var(--color-verdict-watch)]/5 px-3 py-2"
          }
        >
          <div
            className={
              verified
                ? "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-verdict-safe)]"
                : "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-verdict-watch)]"
            }
          >
            {verified ? (
              <ShieldCheck className="size-3" />
            ) : (
              <AlertTriangle className="size-3" />
            )}
            {verified ? "Verified" : "Not verified"} · {sourceLabel}
            {payload.confidence ? ` · ${payload.confidence} confidence` : ""}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {payload.caveat ??
              (verified
                ? "The prerequisite list came from a structured or student-confirmed source."
                : "The prerequisite list was supplied to this tool and has not been confirmed.")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
