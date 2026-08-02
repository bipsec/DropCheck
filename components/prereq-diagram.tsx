"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { FinalDiagram } from "@/lib/api-types";
import { cn } from "@/lib/utils";

type Props = {
  diagram: FinalDiagram;
};

// Three-column layout: prereqs on the left, the dropped course in the
// middle, downstream courses on the right. All edges drawn as SVG
// splines so the DAG scales cleanly. Nothing here is model-generated —
// the whole graph comes from the catalog's `prerequisites` arrays.
export function PrereqDiagram({ diagram }: Props) {
  const prereqs = diagram.nodes.filter((n) => n.kind === "prereq");
  const dropped = diagram.nodes.find((n) => n.kind === "dropped");
  const downstream = diagram.nodes.filter((n) => n.kind === "downstream");

  if (!dropped) return null;

  // If there's no chain to show, skip rendering entirely — the empty
  // diagram would be noisier than useful.
  if (prereqs.length === 0 && downstream.length === 0) return null;

  const nodeW = 96;
  const nodeH = 40;
  const gapY = 12;
  const colGapX = 90;

  const leftCount = Math.max(prereqs.length, 1);
  const rightCount = Math.max(downstream.length, 1);
  const chartH = Math.max(
    leftCount * (nodeH + gapY),
    rightCount * (nodeH + gapY),
    nodeH + gapY,
  );

  const width = nodeW * 3 + colGapX * 2 + 12;
  const height = chartH + 24;

  const colX = {
    prereq: 0,
    dropped: nodeW + colGapX,
    downstream: nodeW * 2 + colGapX * 2,
  };

  const centerY = height / 2 - nodeH / 2;

  function yFor(index: number, total: number): number {
    const stackH = total * nodeH + (total - 1) * gapY;
    const top = height / 2 - stackH / 2;
    return top + index * (nodeH + gapY);
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Prerequisite chain
            </p>
            <p className="mt-0.5 text-sm font-medium">
              What depends on {dropped.label}?
            </p>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">
            {prereqs.length} prereq{prereqs.length === 1 ? "" : "s"} ·{" "}
            {downstream.length} downstream
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full min-w-[540px]"
            role="img"
            aria-label={`Prerequisite chain for ${dropped.label}`}
          >
            {/* Prereq → dropped edges */}
            {prereqs.map((p, i) => {
              const y1 = yFor(i, prereqs.length) + nodeH / 2;
              const y2 = centerY + nodeH / 2;
              const x1 = colX.prereq + nodeW;
              const x2 = colX.dropped;
              const midX = (x1 + x2) / 2;
              return (
                <path
                  key={`pin-${p.id}`}
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={1.25}
                />
              );
            })}

            {/* Dropped → downstream edges */}
            {downstream.map((d, i) => {
              const y1 = centerY + nodeH / 2;
              const y2 = yFor(i, downstream.length) + nodeH / 2;
              const x1 = colX.dropped + nodeW;
              const x2 = colX.downstream;
              const midX = (x1 + x2) / 2;
              return (
                <path
                  key={`dout-${d.id}`}
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--color-verdict-significant)"
                  strokeWidth={1.5}
                  opacity={0.85}
                />
              );
            })}

            {/* Prereq nodes */}
            {prereqs.map((p, i) => (
              <DiagramNodeBox
                key={p.id}
                x={colX.prereq}
                y={yFor(i, prereqs.length)}
                w={nodeW}
                h={nodeH}
                label={p.label}
                kind="prereq"
              />
            ))}

            {/* Dropped node */}
            <DiagramNodeBox
              x={colX.dropped}
              y={centerY}
              w={nodeW}
              h={nodeH}
              label={dropped.label}
              kind="dropped"
            />

            {/* Downstream nodes */}
            {downstream.map((d, i) => (
              <DiagramNodeBox
                key={d.id}
                x={colX.downstream}
                y={yFor(i, downstream.length)}
                w={nodeW}
                h={nodeH}
                label={d.label}
                kind="downstream"
              />
            ))}
          </svg>
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <NodeSwatch kind="prereq" />
            Prerequisite
          </li>
          <li className="flex items-center gap-1.5">
            <NodeSwatch kind="dropped" />
            Dropping
          </li>
          <li className="flex items-center gap-1.5">
            <NodeSwatch kind="downstream" />
            Blocked downstream
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

function DiagramNodeBox({
  x,
  y,
  w,
  h,
  label,
  kind,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: "prereq" | "dropped" | "downstream" | "context";
}) {
  const styles = boxStyles(kind);
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        fill={styles.fill}
        stroke={styles.stroke}
        strokeWidth={kind === "dropped" ? 1.5 : 1}
      />
      <text
        x={x + w / 2}
        y={y + h / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        className="font-mono text-[11px] font-medium"
        fill={styles.textFill}
      >
        {label}
      </text>
    </g>
  );
}

function boxStyles(kind: "prereq" | "dropped" | "downstream" | "context") {
  switch (kind) {
    case "dropped":
      return {
        fill: "color-mix(in oklab, var(--color-lamp) 22%, transparent)",
        stroke: "var(--color-lamp)",
        textFill: "currentColor",
      };
    case "downstream":
      return {
        fill: "color-mix(in oklab, var(--color-verdict-significant) 12%, transparent)",
        stroke: "var(--color-verdict-significant)",
        textFill: "currentColor",
      };
    case "prereq":
    default:
      return {
        fill: "color-mix(in oklab, var(--color-verdict-safe) 12%, transparent)",
        stroke: "var(--color-verdict-safe)",
        textFill: "currentColor",
      };
  }
}

function NodeSwatch({ kind }: { kind: "prereq" | "dropped" | "downstream" }) {
  const s = boxStyles(kind);
  return (
    <span
      className={cn("inline-block h-3 w-4 rounded-sm border")}
      style={{ background: s.fill, borderColor: s.stroke }}
    />
  );
}
