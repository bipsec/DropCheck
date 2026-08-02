"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { searchCatalog } from "@/lib/api";
import type { CatalogSearchHit } from "@/lib/api-types";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onValueChange: (v: string) => void;
  onSelect: (hit: CatalogSearchHit) => void;
  placeholder?: string;
  disabled?: boolean;
};

/**
 * Async course search combobox. Every keystroke → debounce → /catalog/search
 * → dropdown. Selecting a row fires onSelect with the full hit and mirrors
 * the code + title into the input. If the student types a free-text query
 * ("data structures class") they can still submit it — the matcher on the
 * backend will resolve it. This just makes the common "I know the code"
 * path a click instead of a full agent pass.
 */
export function CourseCombobox({
  value,
  onValueChange,
  onSelect,
  placeholder = "CS 310, databases class, …",
  disabled,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [hits, setHits] = React.useState<CatalogSearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const debounced = useDebounced(value.trim(), 220);
  // Guards against races: only the newest request's results paint.
  const reqSeqRef = React.useRef(0);

  React.useEffect(() => {
    if (!debounced || debounced.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const seq = ++reqSeqRef.current;
    setLoading(true);
    searchCatalog(debounced, 8)
      .then((rows) => {
        if (seq !== reqSeqRef.current) return;
        setHits(rows);
        setActiveIdx(0);
      })
      .catch(() => {
        if (seq === reqSeqRef.current) setHits([]);
      })
      .finally(() => {
        if (seq === reqSeqRef.current) setLoading(false);
      });
  }, [debounced]);

  React.useEffect(() => {
    const onClickAway = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClickAway);
    return () => window.removeEventListener("mousedown", onClickAway);
  }, []);

  const commit = (hit: CatalogSearchHit) => {
    onSelect(hit);
    onValueChange(`${hit.course_code} · ${hit.title}`);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => {
            onValueChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || hits.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => Math.min(hits.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              // Only commit the highlighted row on Enter; otherwise let the
              // form submit take the raw text.
              if (open && hits[activeIdx]) {
                e.preventDefault();
                commit(hits[activeIdx]);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="pl-9 pr-9"
          autoComplete="off"
          spellCheck={false}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && hits.length > 0 && (
        <div className="absolute z-30 mt-1.5 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover shadow-lg">
          <ul>
            {hits.map((hit, i) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // Fire before the input's blur so click-away doesn't
                    // hide the popover before onClick lands.
                    e.preventDefault();
                    commit(hit);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                    i === activeIdx
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60"
                  )}
                >
                  <span className="font-mono text-xs">{hit.course_code}</span>
                  <span className="flex-1 truncate">{hit.title}</span>
                  <Badge variant="muted" className="shrink-0">
                    {(hit.similarity * 100).toFixed(0)}%
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && !loading && hits.length === 0 && debounced.length >= 2 && (
        <div className="absolute z-30 mt-1.5 w-full rounded-md border border-dashed border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-sm">
          No catalog hits — you can still submit and let the matcher resolve it.
        </div>
      )}
    </div>
  );
}
