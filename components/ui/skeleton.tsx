import { cn } from "@/lib/utils";

/**
 * Shimmering placeholder used as first-paint content while data loads.
 * Uses the animated CSS gradient from tw-animate-css so we don't burn
 * layout time on a spinner-in-viewport.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted",
        className
      )}
      {...props}
    />
  );
}
