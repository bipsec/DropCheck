import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        lamp: "border-transparent bg-lamp text-ink",
        watch:
          "border-transparent bg-[color:color-mix(in_oklab,var(--color-verdict-watch)_25%,transparent)] text-[color:var(--color-verdict-watch)]",
        significant:
          "border-transparent bg-[color:color-mix(in_oklab,var(--color-verdict-significant)_18%,transparent)] text-[color:var(--color-verdict-significant)]",
        safe:
          "border-transparent bg-[color:color-mix(in_oklab,var(--color-verdict-safe)_20%,transparent)] text-[color:var(--color-verdict-safe)]",
        muted: "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
