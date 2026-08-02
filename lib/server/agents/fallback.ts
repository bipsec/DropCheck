// Deterministic fallback phrasing.
// Ported 1:1 from backend/app/agents/fallback.py.
//
// Runs when the Anthropic key is missing, when a domain agent fails, or
// when the synthesizer cites a resolver field that doesn't exist. Same
// FinalPayload shape as the agent pipeline so the UI renders both the
// same way. Every string here is user-facing prose.

import { CONTACTS } from "@/lib/server/data/policy";
import {
  Confidence,
  DiagramSpec,
  FinalPayload,
  Panel,
  PlotSpec,
  PlotThreshold,
  type DiagramEdge,
  type DiagramNode,
  type PlotSeries,
} from "@/lib/server/schemas/agents";
import type { StudentCtx } from "@/lib/server/services/resolver";

export function phraseFromRules(
  ctx: StudentCtx,
  note?: string | null,
): FinalPayload {
  const academic = academicPanel(ctx);
  const financial = financialPanel(ctx);
  const status = statusPanel(ctx);

  const impactCount = [academic, financial, status].filter((p) => p.hasImpact).length;

  let headline: string;
  if (impactCount === 0) {
    headline = `Dropping ${ctx.course.code} looks low-impact.`;
  } else if (impactCount === 1) {
    headline = `Dropping ${ctx.course.code} has one thing to watch.`;
  } else {
    headline = `Dropping ${ctx.course.code} touches ${impactCount} of your three lanes.`;
  }

  // Note the "impactCount === 1 → high" logic mirrors Python — a single
  // watchpoint doesn't lower our confidence in the deterministic call.
  const confidence: Confidence =
    impactCount === 0 ? "high" : impactCount >= 2 ? "medium" : "high";

  const thresholds: PlotThreshold[] = [
    { label: "Full-time (12)", value: ctx.policy.FULL_TIME_MIN, domain: "financial" },
    { label: "Half-time (6)", value: ctx.policy.HALF_TIME_MIN, domain: "financial" },
  ];
  if (ctx.student.international) {
    thresholds.push({
      label: "F-1 minimum (12)",
      value: ctx.policy.F1_FULL_LOAD_MIN,
      domain: "status",
    });
  }

  const series: PlotSeries[] = [
    { label: "Before", credits: ctx.student.total_credits },
    { label: "After", credits: ctx.after_drop.credits },
  ];

  const plot: PlotSpec = {
    title: `Credits before vs. after dropping ${ctx.course.code}`,
    yAxisLabel: "Credits",
    series,
    thresholds,
  };

  // Full-object parse at the end catches any drift between this function
  // and the schema — same intent as Python's `FinalPayload.model_validate`.
  return FinalPayload.parse({
    course: ctx.course.code,
    headline,
    bottomLine: bottomLine(ctx, impactCount),
    confidence,
    panels: [academic, financial, status],
    diagram: diagram(ctx),
    plot,
    sources: [],
    meta: { mode: "fallback", degraded: false, note: note ?? null },
  });
}

function academicPanel(ctx: StudentCtx): Panel {
  const required = ctx.student.required_for_major;
  const blocked = ctx.prereqs.downstream.slice(0, 3);

  if (required === true && ctx.prereqs.blocks_graduation) {
    let term: string;
    let nextTerm: string;
    if (ctx.prereqs.only_offered_once) {
      term = ctx.course.terms_offered[0];
      nextTerm = `next ${term}`;
    } else {
      term = [...ctx.course.terms_offered].join("/");
      nextTerm = "the next offering";
    }
    return {
      domain: "academic",
      verdict:
        `This delays your degree — ${ctx.course.code} is a required course ` +
        `only offered in ${term}.`,
      detail:
        `Downstream courses that depend on it: ${blocked.join(", ")}. ` +
        `You'd retake ${ctx.course.code} ${nextTerm}, then resume the chain.`,
      nextStep: "Talk to your advisor before the drop deadline",
      nextStepDetail: CONTACTS.advising,
      hasImpact: true,
    };
  }

  if (required === true) {
    return {
      domain: "academic",
      verdict: `${ctx.course.code} is required, but you can retake it without losing time.`,
      detail:
        `Offered in ${[...ctx.course.terms_offered].join(" & ")}, and nothing on your ` +
        `current path is blocked.`,
      nextStep: "Confirm with your advisor before dropping",
      nextStepDetail: CONTACTS.advising,
      hasImpact: true,
    };
  }

  if (required === "unknown") {
    return {
      domain: "academic",
      verdict: `We're not certain ${ctx.course.code} counts toward your major.`,
      detail:
        `Offered in ${[...ctx.course.terms_offered].join(" & ")}. Your advisor can ` +
        `confirm in a minute.`,
      nextStep: "Ask your advisor if this counts",
      nextStepDetail: CONTACTS.advising,
      hasImpact: true,
    };
  }

  return {
    domain: "academic",
    verdict: "No academic impact — this doesn't hold up your degree plan.",
    detail: `${ctx.course.code} isn't required for your major and nothing depends on it.`,
    nextStep: null,
    hasImpact: false,
  };
}

function financialPanel(ctx: StudentCtx): Panel {
  if (ctx.after_drop.below_full_time) {
    const gap = ctx.policy.FULL_TIME_MIN - ctx.after_drop.credits;
    return {
      domain: "financial",
      verdict:
        `Dropping puts you at ${fmt(ctx.after_drop.credits)} credits — ` +
        `${fmt(gap)} below full-time.`,
      detail:
        "Most aid packages, including federal loans and many scholarships, " +
        "assume 12 or more credits. Falling below can reduce or pause " +
        "disbursement for the term.",
      nextStep: "Call financial aid before you drop",
      nextStepDetail:
        `${CONTACTS.financial_aid}. Ask specifically what happens to your ` +
        `award at ${fmt(ctx.after_drop.credits)} credits this term.`,
      hasImpact: true,
    };
  }

  return {
    domain: "financial",
    verdict: "No aid impact — you'll stay above full-time status.",
    detail:
      `You'll be at ${fmt(ctx.after_drop.credits)} credits after dropping, ` +
      "still at or above the 12-credit full-time threshold.",
    nextStep: null,
    hasImpact: false,
  };
}

function statusPanel(ctx: StudentCtx): Panel {
  if (!ctx.student.international) {
    return {
      domain: "status",
      verdict: "No status impact — this doesn't apply to your enrollment type.",
      detail: "",
      nextStep: null,
      hasImpact: false,
    };
  }

  if (ctx.after_drop.credits < ctx.policy.F1_FULL_LOAD_MIN) {
    return {
      domain: "status",
      verdict: "This could affect your F-1 status.",
      detail:
        `F-1 students are generally required to keep a full course load ` +
        `(${ctx.policy.F1_FULL_LOAD_MIN}+ credits). At ` +
        `${fmt(ctx.after_drop.credits)} credits you'd be under it ` +
        `without prior authorization.`,
      nextStep: "Get written approval from your DSO first",
      nextStepDetail:
        `${CONTACTS.dso}. A reduced course load must be authorized in ` +
        "SEVIS before you drop — not after.",
      hasImpact: true,
    };
  }

  return {
    domain: "status",
    verdict: "No status impact — you'll still meet the full course load.",
    detail:
      `${fmt(ctx.after_drop.credits)} credits keeps you at or above the F-1 ` +
      "full-time requirement.",
    nextStep: null,
    hasImpact: false,
  };
}

function bottomLine(ctx: StudentCtx, impactCount: number): string {
  if (impactCount === 0) {
    return "You now have what you need to decide — we're not going to tell you what to do.";
  }

  const talkTo: string[] = [];
  if (ctx.student.required_for_major === true || ctx.prereqs.blocks_graduation) {
    talkTo.push("your advisor");
  }
  if (ctx.after_drop.below_full_time) {
    talkTo.push("financial aid");
  }
  if (
    ctx.student.international &&
    ctx.after_drop.credits < ctx.policy.F1_FULL_LOAD_MIN
  ) {
    talkTo.push("your DSO");
  }

  if (talkTo.length) {
    return `Confirm this decision with ${talkTo.join(" and ")} before the drop deadline.`;
  }
  return "Confirm the specifics with your advisor before the drop deadline.";
}

function diagram(ctx: StudentCtx): DiagramSpec {
  const nodes: DiagramNode[] = [
    { id: ctx.course.code, label: ctx.course.code, kind: "dropped" },
  ];
  const edges: DiagramEdge[] = [];
  for (const prereq of ctx.course.prereqs.slice(0, 4)) {
    nodes.push({ id: prereq, label: prereq, kind: "prereq" });
    edges.push({ from: prereq, to: ctx.course.code });
  }
  for (const down of ctx.prereqs.downstream.slice(0, 6)) {
    nodes.push({ id: down, label: down, kind: "downstream" });
    edges.push({ from: ctx.course.code, to: down });
  }
  return { nodes, edges };
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
