"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, RefreshCcw, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CompletenessMeter } from "@/components/completeness-meter";
import { CoursesSection } from "@/components/courses-section";
import {
  AcademicPanel,
  FinancePanel,
  PreferencesPanel,
} from "@/components/profile-forms";
import { TranscriptUploader } from "@/components/transcript-uploader";
import { getProfile } from "@/lib/api";
import type { ProfileOut } from "@/lib/api-types";

/**
 * Top-level orchestrator for /profile.
 *
 * Fetches once on mount and after any mutating operation. Persists the
 * profile in local state (rather than SWR/react-query) because every write
 * touches multiple related tables and the backend returns the fresh
 * ProfileOut anyway.
 *
 * Session bootstrap needs to finish before we fetch, so we retry once on
 * 401 — the SessionBootstrap effect and this initial fetch race on first
 * paint.
 */
export function ProfileView() {
  const searchParams = useSearchParams();
  const [profile, setProfile] = React.useState<ProfileOut | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [uploaderOpen, setUploaderOpen] = React.useState(false);

  const loadProfile = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const next = await getProfile();
      setProfile(next);
    } catch (err) {
      // 401 = session cookie hasn't landed yet on first paint; retry once
      // after a short delay. The bootstrap effect fires ~immediately after
      // mount, so 200ms is plenty.
      const msg = err instanceof Error ? err.message : String(err);
      if (/No session/i.test(msg) || /401/.test(msg)) {
        await new Promise((r) => setTimeout(r, 250));
        try {
          const retried = await getProfile();
          setProfile(retried);
          return;
        } catch (retryErr) {
          toast.error("Couldn't load profile", {
            description:
              retryErr instanceof Error ? retryErr.message : String(retryErr),
          });
          return;
        }
      }
      toast.error("Couldn't load profile", { description: msg });
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // "Upload transcript" CTA on the landing page opens the uploader
  // automatically via ?upload=1.
  const openParam = searchParams.get("upload");
  React.useEffect(() => {
    if (openParam === "1") setUploaderOpen(true);
  }, [openParam]);

  if (loading && !profile) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="mt-8 h-24 w-full" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_16rem]">
          <div className="space-y-4">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
          <Skeleton className="hidden h-40 w-full lg:block" />
        </div>
      </main>
    );
  }
  if (!profile) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <p className="text-muted-foreground">
          Couldn&apos;t load your profile. Reload the page or check the backend
          is running at <code>/api</code>.
        </p>
      </main>
    );
  }

  const meets = profile.completeness.meets_80;

  return (
    <>
      <TranscriptUploader
        open={uploaderOpen}
        onOpenChange={setUploaderOpen}
        onUploaded={() => loadProfile()}
      />
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Profile
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {profile.student.name || "Your profile"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Everything here becomes context the agents cite when you ask about
              a drop. OCR / extraction fill things in; you fix them.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadProfile()}
              disabled={loading}
            >
              <RefreshCcw className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
            <Button
              variant="lamp"
              size="sm"
              onClick={() => setUploaderOpen(true)}
            >
              <Upload />
              Upload transcript
            </Button>
          </div>
        </div>

        <CompletenessMeter completeness={profile.completeness} />

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <Tabs defaultValue="academic">
              <TabsList>
                <TabsTrigger value="academic">Academic</TabsTrigger>
                <TabsTrigger value="finance">Finance</TabsTrigger>
                <TabsTrigger value="preferences">Preferences</TabsTrigger>
              </TabsList>
              <TabsContent value="academic">
                <AcademicPanel profile={profile} onUpdated={setProfile} />
              </TabsContent>
              <TabsContent value="finance">
                <FinancePanel profile={profile} onUpdated={setProfile} />
              </TabsContent>
              <TabsContent value="preferences">
                <PreferencesPanel profile={profile} onUpdated={setProfile} />
              </TabsContent>
            </Tabs>

            <div className="mt-8">
              <CoursesSection
                courses={profile.courses}
                onChanged={() => loadProfile({ silent: true })}
              />
            </div>
          </div>

          <aside className="lg:sticky lg:top-20 lg:w-64 lg:self-start">
            <div className="rounded-lg border border-lamp/30 bg-lamp/10 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-lamp">
                Next
              </p>
              <p className="mt-3 text-sm text-foreground">
                {meets
                  ? "Your profile has enough context — head to Check Impact and ask about a course."
                  : "Fill in the missing fields flagged above. You can still run impact checks, but answers get sharper the more the agents can cite."}
              </p>
              <Button
                asChild
                variant="lamp"
                size="sm"
                className="mt-4 w-full"
              >
                <Link href="/check">
                  Check impact
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
