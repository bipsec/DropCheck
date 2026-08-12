"use client";

import { cn } from "@/lib/utils";

type SwatchKind = "completed" | "planned" | "unresolved";

function Swatch({ kind }: { kind: SwatchKind }) {
  const style = swatchStyle(kind);
  return (
    <span
      className={cn("inline-block h-3 w-4 rounded-sm border")}
      style={{ background: style.fill, borderColor: style.stroke }}
    />
  );
}

function swatchStyle(kind: SwatchKind) {
  if (kind === "completed") {
    return {
      fill: "color-mix(in oklab, var(--color-verdict-safe) 18%, transparent)",
      stroke: "var(--color-verdict-safe)",
    };
  }
  if (kind === "unresolved") {
    return {
      fill: "color-mix(in oklab, var(--color-verdict-watch) 12%, transparent)",
      stroke: "var(--color-verdict-watch)",
    };
  }
  return {
    fill: "color-mix(in oklab, var(--color-lamp) 22%, transparent)",
    stroke: "var(--color-lamp)",
  };
}

export function TrackLegend() {
  return (
    <ul
      role="list"
      className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground"
    >
      <li className="flex items-center gap-1.5">
        <Swatch kind="completed" />
        Completed
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch kind="planned" />
        Planned
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch kind="unresolved" />
        Needs your input
      </li>
    </ul>
  );
}
