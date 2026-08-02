import Link from "next/link";
import { ArrowRight, Upload, PencilLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Marketing / onboarding page.
 *
 * Two-CTA design from the plan: upload a transcript OR skip to manual entry.
 * Both paths land on /profile — the transcript flow just fills the form for
 * you. Uses the "ink mode" background to distinguish landing from the
 * paper-colored working surface.
 */
export default function LandingPage() {
  return (
    <main className="on-ink min-h-[calc(100dvh-3.5rem)] bg-ink transition-colors duration-500">
      <section className="mx-auto max-w-4xl px-5 pt-24 pb-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-lamp">
          Before you drop
        </p>
        <h1 className="mt-4 max-w-3xl font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          See what dropping this class{" "}
          <span className="text-lamp">actually costs</span>.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          DropCheck ingests your transcript, builds a profile you can edit, and
          answers course-drop questions with a multi-agent Claude pipeline
          grounded on your school&apos;s actual catalog. Academic, financial,
          and enrollment-status impact — before the deadline, in plain language.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild variant="lamp" size="lg">
            <Link href="/profile?upload=1">
              <Upload className="mr-2" />
              Upload transcript
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/profile">
              <PencilLine className="mr-2" />
              Start manually
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-24">
        <div className="grid gap-4 md:grid-cols-3">
          <StepCard
            index="01"
            title="Build a profile"
            body="Drag a transcript PDF and DropCheck extracts your program, GPA, credits, courses, and financial aid — anything it isn't sure about stays null so you can fill it in yourself."
          />
          <StepCard
            index="02"
            title="Grounded catalog match"
            body="Every parsed course is matched against your school's real catalog via embeddings + LLM disambiguation, so downstream impact is grounded on the actual prereq chains."
          />
          <StepCard
            index="03"
            title="Ask a real question"
            body='"Should I drop CS 310?" fans out to three domain agents (academic, financial, status), joins at a synthesizer, and returns a three-panel answer with citations you can audit.'
          />
        </div>

        <Card className="mt-8 border-lamp/30 bg-ink-soft/60">
          <CardContent className="flex flex-wrap items-center gap-4 p-6">
            <Sparkles className="size-5 text-lamp" />
            <p className="flex-1 text-sm text-muted-foreground">
              Follow-up chat carries the whole conversation. Ask&nbsp;
              <em>&quot;what if I also drop MATH 210?&quot;</em>&nbsp;and the pipeline
              re-runs on the amended state. Ask&nbsp;
              <em>&quot;what did you mean by SAP?&quot;</em>&nbsp;and it clarifies
              without spending a full agent pass.
            </p>
            <Button asChild variant="ghost" size="sm">
              <Link href="/check">
                See it in action
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
