// Plain async orchestrator — replaces LangGraph's StateGraph.
// Ported from backend/app/agents/graph.py.
//
// Topology (unchanged):
//
//     router ─(route_kind)─┬─ clarification ────────────────────────► END
//                          │
//                          └─ context → intake → { academic ∥ financial ∥ status } → synthesis → END
//
// LangGraph's `operator.add` reducer on `trace_events` becomes an
// explicit `merge` here: partial updates from parallel nodes get their
// `trace_events` concatenated onto the accumulated list.

import {
  academicNode,
  clarificationNode,
  contextNode,
  financialNode,
  intakeNode,
  routerNode,
  statusNode,
  synthesisNode,
} from "@/lib/server/agents/nodes";
import type {
  DropCheckState,
  NodePartial,
  TraceEvent,
} from "@/lib/server/agents/state";

function merge(state: DropCheckState, partial: NodePartial): DropCheckState {
  const nextEvents: TraceEvent[] = [
    ...(state.trace_events ?? []),
    ...(partial.trace_events ?? []),
  ];
  const { trace_events: _drop, ...rest } = partial;
  void _drop;
  return { ...state, ...rest, trace_events: nextEvents };
}

export async function runGraph(
  initialState: DropCheckState,
): Promise<DropCheckState> {
  let state: DropCheckState = {
    ...initialState,
    trace_events: initialState.trace_events ?? [],
  };

  state = merge(state, await routerNode(state));
  if (state.error) return state;

  if (state.route_kind === "clarification") {
    state = merge(state, await clarificationNode(state));
    return state;
  }

  state = merge(state, await contextNode(state));
  if (state.error) return state;

  state = merge(state, await intakeNode(state));

  // Parallel domain fan-out — matches LangGraph's parallel edges from intake.
  const [ac, fi, st] = await Promise.all([
    academicNode(state),
    financialNode(state),
    statusNode(state),
  ]);
  state = merge(state, ac);
  state = merge(state, fi);
  state = merge(state, st);

  state = merge(state, await synthesisNode(state));
  return state;
}
