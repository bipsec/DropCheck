"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LampSignature } from "@/components/lamp-signature";
import { cn } from "@/lib/utils";

/**
 * App-wide nav. Two visual modes:
 *   - default (paper): border underneath, translucent background so it feels
 *     laid on the page
 *   - ink (landing hero): transparent, no border, so the nav floats over
 *     the dark hero without a hard seam.
 * The mode is picked by whether we're on `/` — nothing else opts in yet.
 */
export function TopNav() {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  return (
    <header
      className={cn(
        "sticky top-0 z-30 transition-colors",
        isLanding
          ? // Match the ink hero below — same surface color, no seam.
            "on-ink bg-ink text-paper"
          : "border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      )}
    >
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight"
        >
          <LampSignature glowing={isLanding} />
          DropCheck
        </Link>
        <div className="ml-2 flex items-center gap-1 text-sm">
          <NavLink href="/profile" pathname={pathname}>
            Profile
          </NavLink>
          <NavLink href="/check" pathname={pathname}>
            Check impact
          </NavLink>
        </div>
      </nav>
    </header>
  );
}

function NavLink({
  href,
  pathname,
  children,
}: {
  href: string;
  pathname: string;
  children: React.ReactNode;
}) {
  const isActive = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-3 py-1.5 transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      )}
    >
      {children}
    </Link>
  );
}
