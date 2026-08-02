"use client";

import * as React from "react";
import { Send, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  onSubmit: (question: string) => Promise<void>;
  submitting: boolean;
  disabled?: boolean;
};

const HINTS = [
  "What did you mean by SAP?",
  "What if I also drop MATH 201?",
  "Why did you say I'm below full-time?",
];

/**
 * Follow-up chat composer. Small hint pills seed common turn types
 * (clarification / what-if). Router decides which path the pipeline
 * takes — the composer doesn't need to know.
 */
export function FollowupComposer({ onSubmit, submitting, disabled }: Props) {
  const [text, setText] = React.useState("");
  const ref = React.useRef<HTMLTextAreaElement | null>(null);

  const submit = async () => {
    if (!text.trim() || submitting || disabled) return;
    const q = text.trim();
    setText("");
    await onSubmit(q);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {HINTS.map((h) => (
          <button
            key={h}
            type="button"
            className="rounded-full border border-border/60 bg-muted/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            onClick={() => {
              setText(h);
              ref.current?.focus();
            }}
            disabled={submitting || disabled}
          >
            {h}
          </button>
        ))}
      </div>
      <Textarea
        ref={ref}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask a follow-up — clarification, a what-if, whatever."
        disabled={submitting || disabled}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">
            ⌘/Ctrl + Enter
          </kbd>{" "}
          or the send button — the router picks the right path.
        </p>
        <Button
          type="button"
          variant="lamp"
          size="sm"
          onClick={submit}
          disabled={!text.trim() || submitting || disabled}
        >
          {submitting ? (
            <>
              <Loader2 className="animate-spin" />
              Sending
            </>
          ) : (
            <>
              <Send />
              Send
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
