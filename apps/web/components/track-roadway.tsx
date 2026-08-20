"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  GenericCodesBanner,
  type CodeNamespaceFields,
} from "@/components/generic-codes-banner";
import { TrackLegend } from "@/components/track-legend";
import type { Track } from "@dropcheck/shared";
import { cn } from "@/lib/utils";

/**
 * Roadway-style track visualization.
 *
 * Renders each term as a "station" along a horizontal road, with the
 * planned courses stacked as milestones below each station. Completed
 * courses (passed in via `completedCodes`) get a distinct chip color;
 * unresolved slots trail after the last station as dashed placeholders;
 * a checkered graduation marker anchors the far right.
 *
 * All layout is a single SVG so the road segments + station rings scale
 * cleanly across viewport widths. Nothing here is model-generated; the
 * `Track` shape comes directly from the deterministic scheduler.
 */

/**
 * `build_track` spreads the deterministic `Track` and then stamps the
 * namespace fields alongside it — `Track` itself is a strict schema built
 * by the scheduler, so the disclosure rides on the wire rather than in
 * the shape. Hence the intersection instead of a widened `Track`.
 */
export type TrackPayload = Track & CodeNamespaceFields;

type Props = {
  track: TrackPayload;
  /** Course codes the student already has credit for. */
  completedCodes?: Set<string>;
};

const STATION_SPACING = 200;
const STATION_R = 12;
const COURSE_H = 26;
const COURSE_GAP = 6;
const TOP_MARGIN = 46;
const BODY_TOP_MARGIN = 24;
const LEFT_MARGIN = 40;

export function TrackRoadway({ track, completedCodes }: Props) {
  const completed = completedCodes ?? new Set<string>();
  const stationCount = track.terms.length;

  // Compute widths + total height.
  const tallestTerm = track.terms.reduce(
    (m, t) => Math.max(m, t.courses.length),
    0,
  );
  const bodyHeight =
    tallestTerm * (COURSE_H + COURSE_GAP) + BODY_TOP_MARGIN + 40;
  const totalHeight = TOP_MARGIN + bodyHeight;
  const totalWidth = LEFT_MARGIN * 2 + Math.max(1, stationCount) * STATION_SPACING;
  const roadY = TOP_MARGIN;

  return (
    <Card>
      <CardContent className="p-5">
        {/* Above the plan, deliberately — disclosing after it is the
            specific failure this fixes. */}
        <GenericCodesBanner payload={track} />
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Journey · {track.program_id}
            </p>
            <p className="mt-0.5 text-sm font-medium">
              {track.total_terms} stop{track.total_terms === 1 ? "" : "s"} to{" "}
              {track.projected_grad_term.season}{" "}
              {track.projected_grad_term.year}
              {track.generated_for === "in_progress" && (
                <span className="ml-2 rounded bg-lamp/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-lamp">
                  In progress
                </span>
              )}
            </p>
          </div>
          <TrackLegend />
        </div>

        {track.terms.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            No stations to draw — the scheduler had nothing to place.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${totalWidth} ${totalHeight}`}
              className="w-full min-w-[720px]"
              role="img"
              aria-label={`Roadway plan for ${track.program_id}`}
            >
              {/* --- Road base (dark asphalt) --- */}
              <rect
                x={LEFT_MARGIN - 20}
                y={roadY - 5}
                width={totalWidth - (LEFT_MARGIN - 20) * 2 + 40}
                height={10}
                rx={5}
                fill="var(--color-ink)"
                opacity={0.85}
              />
              {/* --- Road dashed centerline --- */}
              <line
                x1={LEFT_MARGIN - 12}
                x2={totalWidth - LEFT_MARGIN + 12}
                y1={roadY}
                y2={roadY}
                stroke="var(--color-lamp)"
                strokeWidth={1.5}
                strokeDasharray="8 8"
                opacity={0.9}
              />

              {/* --- "Start" flag (leftmost) --- */}
              <g transform={`translate(${LEFT_MARGIN - 20}, ${roadY})`}>
                <circle
                  r={5}
                  fill="var(--color-lamp)"
                  stroke="var(--color-ink)"
                  strokeWidth={1.5}
                />
                <text
                  x={0}
                  y={-14}
                  textAnchor="middle"
                  className="font-mono text-[9px] uppercase tracking-wider"
                  fill="currentColor"
                >
                  start
                </text>
              </g>

              {/* --- Stations + course stacks --- */}
              {track.terms.map((term, i) => {
                const cx = LEFT_MARGIN + STATION_SPACING * i + STATION_SPACING / 2;
                return (
                  <g key={i}>
                    {/* Station ring */}
                    <circle
                      cx={cx}
                      cy={roadY}
                      r={STATION_R + 3}
                      fill="var(--color-background)"
                      stroke="var(--color-ink)"
                      strokeWidth={1.5}
                    />
                    <circle
                      cx={cx}
                      cy={roadY}
                      r={STATION_R}
                      fill="color-mix(in oklab, var(--color-lamp) 22%, transparent)"
                      stroke="var(--color-lamp)"
                      strokeWidth={2}
                    />
                    {/* Term label above station */}
                    <text
                      x={cx}
                      y={roadY - STATION_R - 12}
                      textAnchor="middle"
                      className="font-mono text-[11px] font-medium"
                      fill="currentColor"
                    >
                      {term.term.season} {term.term.year}
                    </text>
                    <text
                      x={cx}
                      y={roadY + 4}
                      textAnchor="middle"
                      className="font-mono text-[10px] font-semibold"
                      fill="var(--color-lamp)"
                    >
                      {i + 1}
                    </text>
                    {/* Credits chip below station */}
                    <text
                      x={cx}
                      y={roadY + STATION_R + 18}
                      textAnchor="middle"
                      className="fill-muted-foreground font-mono text-[9px] uppercase tracking-wider"
                    >
                      {term.credits_this_term}cr · cum{" "}
                      {term.cumulative_credits}
                    </text>

                    {/* Course stack — cards trailing down from station */}
                    {term.courses.map((course, j) => {
                      const y =
                        roadY +
                        STATION_R +
                        BODY_TOP_MARGIN +
                        j * (COURSE_H + COURSE_GAP);
                      const done = completed.has(course.course_code);
                      return (
                        <CourseChip
                          key={`${i}-${course.course_code}`}
                          x={cx - STATION_SPACING / 2 + 12}
                          y={y}
                          width={STATION_SPACING - 24}
                          label={course.course_code}
                          credits={course.credits}
                          done={done}
                        />
                      );
                    })}
                  </g>
                );
              })}

              {/* --- Checkered finish flag --- */}
              <g
                transform={`translate(${totalWidth - LEFT_MARGIN + 8}, ${roadY})`}
              >
                <FinishFlag />
                <text
                  x={0}
                  y={-14}
                  textAnchor="middle"
                  className="font-mono text-[9px] uppercase tracking-wider"
                  fill="currentColor"
                >
                  grad
                </text>
              </g>
            </svg>
          </div>
        )}

        {/* Unresolved slots — trailing chips below, since they have no station of their own */}
        {track.unresolved.length > 0 && (
          <div className="mt-4 rounded-md border border-dashed border-[color:var(--color-verdict-watch)]/50 bg-[color:var(--color-verdict-watch)]/5 p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-verdict-watch)]">
              Unresolved · needs your input
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {track.unresolved.slice(0, 5).map((s, i) => (
                <li key={i}>
                  <span className="font-mono">{s.category_id}</span> — {s.credits_needed} credit
                  {s.credits_needed === 1 ? "" : "s"} owed
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Course chip --------------------------------------------------------

function CourseChip({
  x,
  y,
  width,
  label,
  credits,
  done,
}: {
  x: number;
  y: number;
  width: number;
  label: string;
  credits: number;
  done: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={COURSE_H}
        rx={5}
        fill={
          done
            ? "color-mix(in oklab, var(--color-verdict-safe) 18%, transparent)"
            : "color-mix(in oklab, var(--color-lamp) 20%, transparent)"
        }
        stroke={
          done
            ? "var(--color-verdict-safe)"
            : "var(--color-lamp)"
        }
        strokeWidth={1}
      />
      <text
        x={x + 10}
        y={y + COURSE_H / 2 + 3}
        className={cn("font-mono text-[11px] font-medium")}
        fill="currentColor"
      >
        {label}
      </text>
      <text
        x={x + width - 10}
        y={y + COURSE_H / 2 + 3}
        textAnchor="end"
        className="fill-muted-foreground font-mono text-[10px]"
      >
        {credits}cr
      </text>
    </g>
  );
}

// --- Finish flag --------------------------------------------------------

function FinishFlag() {
  // Tiny 4x2 checkered pattern on a small pole.
  const cell = 4;
  const rows = 2;
  const cols = 4;
  return (
    <g>
      {/* Pole */}
      <line
        x1={0}
        x2={0}
        y1={0}
        y2={-14}
        stroke="var(--color-ink)"
        strokeWidth={1}
      />
      {/* Flag */}
      {Array.from({ length: rows * cols }).map((_, k) => {
        const r = Math.floor(k / cols);
        const c = k % cols;
        const isDark = (r + c) % 2 === 0;
        return (
          <rect
            key={k}
            x={1 + c * cell}
            y={-13 + r * cell}
            width={cell}
            height={cell}
            fill={isDark ? "var(--color-ink)" : "var(--color-lamp)"}
          />
        );
      })}
      {/* Finish dot on the road */}
      <circle r={5} fill="var(--color-lamp)" stroke="var(--color-ink)" strokeWidth={1.5} />
    </g>
  );
}
