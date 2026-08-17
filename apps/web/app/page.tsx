import Link from "next/link";
import { ArrowRight, MessagesSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Landing page for the Academic Companion. Single CTA: start chatting.
 * The advisor mints an anonymous session, remembers what you tell it
 * across visits, and grounds every prereq / credit / term claim in a
 * real tool call (Claude Agent SDK + three MCP servers).
 */
export default function LandingPage() {
  return (
    <main className="on-ink min-h-[calc(100dvh-3.5rem)] bg-ink transition-colors duration-500">
      <section className="mx-auto max-w-4xl px-5 pt-24 pb-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-lamp">
          Academic Companion
        </p>
        <h1 className="mt-4 max-w-3xl font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          A year-long advisor that <span className="text-lamp">remembers you</span>.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Talk through your degree, term by term. The Companion pulls real
          Purdue course data, walks the prereq graph, and keeps a profile
          across the whole academic year — so a question in April builds on
          what you told it in September, not a blank slate.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild variant="lamp" size="lg">
            <Link href="/chat">
              <MessagesSquare className="mr-2" />
              Start a conversation
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-24">
        <div className="grid gap-4 md:grid-cols-3">
          <StepCard
            index="01"
            title="Grounded on real data"
            body="Every course lookup goes through the university-catalog MCP server, which wraps api.purdue.io and caches per-term. No fabricated prereqs, no invented credit counts."
          />
          <StepCard
            index="02"
            title="Deterministic degree math"
            body="Prereq checks, degree-progress, drop-impact cascades, and term-by-term planning all run through a rules-engine MCP server — pure logic the model doesn't get to override."
          />
          <StepCard
            index="03"
            title="Continuity across the year"
            body="Your profile — courses taken, waivers, transfers, and every advising note — persists per session cookie. The Companion picks up your thread on the next visit."
          />
        </div>

        <Card className="mt-8 border-lamp/30 bg-ink-soft/60">
          <CardContent className="flex flex-wrap items-center gap-4 p-6">
            <Sparkles className="size-5 text-lamp" />
            <p className="flex-1 text-sm text-muted-foreground">
              Not at Purdue? The Companion says so plainly and falls back to
              archetype-level guidance — it never pretends to know a school
              it doesn&apos;t have data for.
            </p>
            <Button asChild variant="ghost" size="sm">
              <Link href="/chat">
                Try it
                <ArrowRight className="ml-1" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function StepCard({
  index,
  title,
  body,
}: {
  index: string;
  title: string;
  body: string;
}) {
  return (
    <Card className="border-border/40 bg-ink-soft/70">
      <CardContent className="p-6">
        <p className="font-mono text-xs tracking-[0.2em] text-lamp">{index}</p>
        <h3 className="mt-2 font-display text-xl font-semibold tracking-tight">
          {title}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
