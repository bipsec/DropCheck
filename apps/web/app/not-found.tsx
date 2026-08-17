import Link from "next/link";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <Compass className="mt-0.5 size-6 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                404
              </p>
              <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
                We don&apos;t have a page there.
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Try the profile, run an impact check, or head home.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild variant="lamp" size="sm">
                  <Link href="/">Home</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/profile">Profile</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/check">Check impact</Link>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
