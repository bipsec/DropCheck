"use client";

import { GraduationCap, Wallet, Plane, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Panel } from "@/lib/api-types";
import { cn } from "@/lib/utils";

/**
 * One of the three domain panels in the result. Reads the panel's
 * `hasImpact` flag to decide badge tone and layout weight — impact rows
 * get a warmer surface so the eye lands on them first.
 */
export function ConsequenceCard({ panel }: { panel: Panel }) {
  const meta = DOMAIN_META[panel.domain];
  const Icon = meta.icon;
  return (
    <Card
      className={cn(
        "h-full border-border/60 transition-colors",
        panel.hasImpact && "border-lamp/50 bg-lamp/5"
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {meta.label}
          </p>
          <div className="ml-auto">
            <Badge variant={panel.hasImpact ? "watch" : "safe"}>
              {panel.hasImpact ? "Impact" : "OK"}
            </Badge>
          </div>
        </div>
        <p className="mt-3 font-display text-base font-semibold leading-snug tracking-tight">
          {panel.verdict}
        </p>
        {panel.detail && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {panel.detail}
          </p>
        )}
        {panel.nextStep && (
          <div className="mt-4 rounded-md border border-lamp/30 bg-background p-3">
            <p className="flex items-center gap-2 text-xs font-medium">
              <Phone className="size-3 text-lamp" />
              {panel.nextStep}
            </p>
            {panel.nextStepDetail && (
              <p className="mt-1 text-xs text-muted-foreground">
                {panel.nextStepDetail}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const DOMAIN_META: Record<Panel["domain"], { label: string; icon: typeof GraduationCap }> = {
  academic: { label: "Academic", icon: GraduationCap },
  financial: { label: "Financial aid", icon: Wallet },
  status: { label: "Enrollment status", icon: Plane },
};
