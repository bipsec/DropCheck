"use client";

import { cn } from "@/lib/utils";

/**
 * Tiny brand mark — a "lamp" that pulses while an agent pass is running.
 * Static disc when idle, soft breathing halo when active. Referenced from
 * the AgentTracePanel header.
 */
export function LampSignature({ glowing = false }: { glowing?: boolean }) {
  return (
    <span className="relative inline-flex size-6 items-center justify-center">
      <span
        className={cn(
          "absolute inset-0 rounded-full bg-lamp/40 blur-md transition-opacity duration-500",
          glowing ? "opacity-100 animate-pulse" : "opacity-0"
        )}
      />
      <span className="relative size-2.5 rounded-full bg-lamp shadow-[0_0_8px_var(--color-lamp)]" />
    </span>
  );
}
