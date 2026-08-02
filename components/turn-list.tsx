"use client";

import { User } from "lucide-react";

import { ResultView } from "@/components/result-view";
import type { ConversationTurn } from "@/lib/api-types";

type Props = {
  turns: ConversationTurn[];
  courseCode?: string;
};

/**
 * Renders a whole conversation thread.
 *
 * User turns appear as a plain-prose bubble; assistant turns render the
 * full ResultView (headline + panels, or a clarification banner). This
 * component is used both to render live state (turns built up during the
 * current session) and reloaded history from GET /conversations/{id}.
 */
export function TurnList({ turns, courseCode }: Props) {
  if (turns.length === 0) return null;

  return (
    <div className="space-y-6">
      {turns.map((turn) => (
        <div key={turn.id}>
          {turn.role === "user" ? (
            <UserTurn text={turn.query ?? ""} />
          ) : turn.response ? (
            <ResultView final={turn.response} courseCode={courseCode} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] items-start gap-3">
        <div className="rounded-2xl rounded-tr-sm border border-lamp/30 bg-lamp/10 px-4 py-3 text-sm leading-relaxed">
          <p className="whitespace-pre-line text-foreground">{text}</p>
        </div>
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-paper">
          <User className="size-4" />
        </div>
      </div>
    </div>
  );
}
