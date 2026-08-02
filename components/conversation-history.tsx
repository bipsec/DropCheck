"use client";

import * as React from "react";
import { History, Loader2, Trash2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listConversations } from "@/lib/api";
import type { ConversationSummary } from "@/lib/api-types";
import { cn } from "@/lib/utils";

type Props = {
  activeId: string | null;
  onOpen: (id: string) => void;
  onReset: () => void;
  refreshToken: number;
};

/**
 * Sidebar list of recent conversations for this session. `refreshToken`
 * is bumped by the parent after every new turn so the list re-fetches
 * without needing an explicit ref.
 */
export function ConversationHistory({
  activeId,
  onOpen,
  onReset,
  refreshToken,
}: Props) {
  const [rows, setRows] = React.useState<ConversationSummary[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listConversations()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            History
          </p>
          {activeId && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 gap-1 px-2 text-xs"
              onClick={onReset}
              title="Start a new conversation"
            >
              <Trash2 className="size-3" />
              New
            </Button>
          )}
        </div>

        {loading && !rows ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : rows && rows.length > 0 ? (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className={cn(
                    "flex w-full flex-col rounded-md border border-transparent px-3 py-2 text-left transition-colors",
                    activeId === row.id
                      ? "border-lamp/40 bg-lamp/10"
                      : "hover:bg-accent/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">
                      {row.course_code ?? "—"}
                    </span>
                    {activeId === row.id && (
                      <Badge variant="lamp" className="text-[10px]">
                        Active
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {formatTime(row.created_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-xs text-muted-foreground">
            No conversations yet. Ask about a course to start one.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    // Local, compact — "Aug 2, 3:14 PM".
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}
