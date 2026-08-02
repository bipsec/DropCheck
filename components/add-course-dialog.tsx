"use client";

import * as React from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addCourse } from "@/lib/api";

type Props = {
  onAdded: () => void;
};

/**
 * Add a course manually. Adds go in as source=manual_edit + confirmed_by_student=true
 * so they survive a future transcript re-upload without being clobbered.
 */
export function AddCourseDialog({ onAdded }: Props) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    course_code: "",
    title: "",
    grade: "",
    credits: "",
    semester: "",
  });

  const reset = () =>
    setForm({ course_code: "", title: "", grade: "", credits: "", semester: "" });

  const submit = async () => {
    if (!form.course_code.trim()) {
      toast.error("Course code is required");
      return;
    }
    setSaving(true);
    try {
      const credits =
        form.credits.trim() === "" ? null : Number(form.credits);
      await addCourse({
        course_code: form.course_code.trim(),
        title: form.title.trim() || null,
        grade: form.grade.trim() || null,
        credits: Number.isFinite(credits) ? credits : null,
        semester: form.semester.trim() || null,
      });
      toast.success("Course added");
      setOpen(false);
      reset();
      onAdded();
    } catch (err) {
      toast.error("Add failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" />
          Add course
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a course manually</DialogTitle>
          <DialogDescription>
            Handy for courses the transcript missed, or for planning future
            terms.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label htmlFor="course-code">Course code</Label>
            <Input
              id="course-code"
              value={form.course_code}
              onChange={(e) => setForm({ ...form, course_code: e.target.value })}
              placeholder="CS 201"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="course-title">Title</Label>
            <Input
              id="course-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Data Structures"
              className="mt-1.5"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="course-grade">Grade</Label>
              <Input
                id="course-grade"
                value={form.grade}
                onChange={(e) => setForm({ ...form, grade: e.target.value })}
                placeholder="B+"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="course-credits">Credits</Label>
              <Input
                id="course-credits"
                inputMode="decimal"
                value={form.credits}
                onChange={(e) => setForm({ ...form, credits: e.target.value })}
                placeholder="3"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="course-semester">Semester</Label>
              <Input
                id="course-semester"
                value={form.semester}
                onChange={(e) => setForm({ ...form, semester: e.target.value })}
                placeholder="Fall 2024"
                className="mt-1.5"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="lamp" onClick={submit} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="animate-spin" />
                Saving…
              </>
            ) : (
              "Add course"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
