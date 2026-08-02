"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { FinalPlot } from "@/lib/api-types";

type Props = {
  plot: FinalPlot;
};

// Simple SVG bar chart with horizontal threshold lines. All values come
// straight from the resolver — no model output involved — so what the
// student sees always matches the numbers cited in the panels.
export function CreditPlot({ plot }: Props) {
  if (!plot.series.length) return null;

  const maxValue = Math.max(
    ...plot.series.map((s) => s.credits),
    ...plot.thresholds.map((t) => t.value),
    15, // don't collapse to a spike when everything's tiny
  );

  const width = 480;
  const height = 220;
  const padding = { top: 24, right: 24, bottom: 40, left: 44 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const barSlot = chartW / plot.series.length;
  const barWidth = Math.min(72, barSlot * 0.55);

  const scaleY = (v: number) => padding.top + chartH - (v / maxValue) * chartH;

  const beforeCredits = plot.series[0]?.credits ?? 0;
  const afterCredits = plot.series[1]?.credits ?? 0;
  const delta = afterCredits - beforeCredits;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Credit load
            </p>
            <p className="mt-0.5 text-sm font-medium">{plot.title}</p>
          </div>
          <span
            className={
              "font-mono text-xs " +
              (delta < 0
                ? "text-[color:var(--color-verdict-watch)]"
                : "text-muted-foreground")
            }
          >
            {delta === 0 ? "±0" : delta > 0 ? `+${delta}` : delta} credits
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full max-w-xl"
            role="img"
            aria-label={plot.title}
          >
            {/* Axis */}
            <line
              x1={padding.left}
              x2={padding.left}
              y1={padding.top}
              y2={padding.top + chartH}
              stroke="currentColor"
              className="text-border"
              strokeWidth={1}
            />
            <line
              x1={padding.left}
              x2={padding.left + chartW}
              y1={padding.top + chartH}
              y2={padding.top + chartH}
              stroke="currentColor"
              className="text-border"
              strokeWidth={1}
            />

            {/* Y-axis ticks */}
            {[0, Math.round(maxValue / 2), Math.ceil(maxValue)].map((v) => (
              <g key={v}>
                <line
                  x1={padding.left - 4}
                  x2={padding.left}
                  y1={scaleY(v)}
                  y2={scaleY(v)}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={1}
                />
                <text
                  x={padding.left - 8}
                  y={scaleY(v)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground font-mono text-[10px]"
                >
                  {v}
                </text>
              </g>
            ))}

            {/* Threshold lines */}
            {plot.thresholds.map((t, i) => {
              const y = scaleY(t.value);
              const color =
                t.domain === "financial"
                  ? "var(--color-verdict-watch)"
                  : t.domain === "status"
                    ? "var(--color-verdict-significant)"
                    : "var(--color-lamp)";
              return (
                <g key={i}>
                  <line
                    x1={padding.left}
                    x2={padding.left + chartW}
                    y1={y}
                    y2={y}
                    stroke={color}
                    strokeWidth={1.25}
                    strokeDasharray="4 3"
                    opacity={0.7}
                  />
                  <text
                    x={padding.left + chartW - 6}
                    y={y - 4}
                    textAnchor="end"
                    className="font-mono text-[10px]"
                    fill={color}
                  >
                    {t.label}
                  </text>
                </g>
              );
            })}

            {/* Bars */}
            {plot.series.map((s, i) => {
              const cx = padding.left + barSlot * i + barSlot / 2;
              const x = cx - barWidth / 2;
              const y = scaleY(s.credits);
              const h = padding.top + chartH - y;
              const isAfter = i === plot.series.length - 1;
              const fill = isAfter
                ? "var(--color-lamp)"
                : "color-mix(in oklab, var(--color-lamp) 40%, transparent)";
              return (
                <g key={i}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(2, h)}
                    fill={fill}
                    rx={4}
                  />
                  <text
                    x={cx}
                    y={y - 6}
                    textAnchor="middle"
                    className="fill-foreground font-mono text-[11px] font-medium"
                  >
                    {s.credits}
                  </text>
                  <text
                    x={cx}
                    y={padding.top + chartH + 18}
                    textAnchor="middle"
                    className="fill-muted-foreground font-mono text-[10px] uppercase tracking-wide"
                  >
                    {s.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Legend for thresholds */}
        {plot.thresholds.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
            {plot.thresholds.map((t, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-px w-3 border-t border-dashed"
                  style={{
                    borderColor:
                      t.domain === "financial"
                        ? "var(--color-verdict-watch)"
                        : t.domain === "status"
                          ? "var(--color-verdict-significant)"
                          : "var(--color-lamp)",
                  }}
                />
                {t.label}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
