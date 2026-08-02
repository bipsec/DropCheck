"use client";

import * as React from "react";
import { Sparkles, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CourseCombobox } from "@/components/course-combobox";
import type { CatalogSearchHit } from "@/lib/api-types";

type Props = {
  onSubmit: (course: string, question: string) => Promise<void>;
  disabled?: boolean;
  submitting?: boolean;
};

const DEFAULT_QUESTION = "Should I drop this class?";

/**
 * The first-turn query composer. Course goes through the combobox so a
 * catalog match is guaranteed most of the time; the question is a
 * free-text textarea seeded with a sensible default.
 */
export function QueryForm({ onSubmit, disabled, submitting }: Props) {
  const [course, setCourse] = React.useState("");
  const [question, setQuestion] = React.useState(DEFAULT_QUESTION);

  const handleSelect = (_hit: CatalogSearchHit) => {
    // Combobox already mirrors "CODE · Title" into `course` via
    // onValueChange, so nothing else to do here. This hook stays for
    // future analytics or auto-focus behaviors.
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!course.trim() || !question.trim() || submitting) return;
    await onSubmit(course.trim(), question.trim());
  };

  return (
    <Card>
      <CardContent className="p-6">
        <form onSubmit={submit} className="space-y-5">
          <div>
            <Label htmlFor="course">Course</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Search by code, title, or a free-form description — the matcher
              resolves the rest.
            </p>
            <div className="mt-2">
              <CourseCombobox
                value={course}
                onValueChange={setCourse}
                onSelect={handleSelect}
                disabled={disabled || submitting}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="question">Your question</Label>
            <Textarea
              id="question"
              className="mt-2"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Should I drop this class? Anything specific to weigh?"
              disabled={disabled || submitting}
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <p className="mr-auto text-xs text-muted-foreground">
              Full run: 4 agents in parallel, ~40–70 s.
            </p>
            <Button
              type="submit"
              variant="lamp"
              disabled={
                disabled ||
                submitting ||
                !course.trim() ||
                !question.trim()
              }
              className="min-w-36"
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Sparkles />
                  Check impact
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
