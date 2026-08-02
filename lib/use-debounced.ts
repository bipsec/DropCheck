"use client";

import { useEffect, useState } from "react";

/**
 * Returns a debounced echo of `value`. The timer resets on every change and
 * fires the update `delayMs` after the last mutation. Used by the course
 * combobox to keep /catalog/search calls to one per lull.
 */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [echo, setEcho] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setEcho(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return echo;
}
