"use client";

import * as React from "react";
import {
  CheckCircle2,
  Pencil,
  Save,
  Trash2,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddCourseDialog } from "@/components/add-course-dialog";
import { deleteCourse, patchCourse } from "@/lib/api";
import type { CourseRow } from "@/lib/api-types";
import { cn } from "@/lib/utils";

type Props = {
  courses: CourseRow[];
  onChanged: () => void;
};

/**
 * Editable course table.
 *
 * Match confidence is surfaced as a small badge so students can eyeball
 * which parse rows are trustworthy. Rows edited inline flip
 * confirmed_by_student=true — the redesign plan calls that out as a core
 * UX cue for auto-detected vs. verified data.
 */
export function CoursesSection({ courses, onChanged }: Props) {
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const matched = courses.filter((c) => c.catalog_course_id).length;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight">
              Courses
            </h2>
            <p className="text-xs text-muted-foreground">
              {courses.length} on record · {matched} matched to catalog
            </p>
          </div>
          <AddCourseDialog onAdded={onChanged} />
        </div>

        {courses.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No courses yet. Upload a transcript or add one manually.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Grade</th>
                  <th className="px-3 py-2 font-medium">Credits</th>
                  <th className="px-3 py-2 font-medium">Semester</th>
                  <th className="px-3 py-2 font-medium">Match</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {courses.map((row) => (
                  <CourseRowView
                    key={row.id}
                    row={row}
                    isEditing={editingId === row.id}
                    onStartEdit={() => setEditingId(row.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaved={() => {
                      setEditingId(null);
                      onChanged();
                    }}
                    onDeleted={onChanged}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CourseRowView({
  row,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaved,
  onDeleted,
}: {
  row: CourseRow;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  if (isEditing) {
    return (
      <EditingRow row={row} onCancel={onCancelEdit} onSaved={onSaved} />
    );
  }
  return <ReadOnlyRow row={row} onEdit={onStartEdit} onDeleted={onDeleted} />;
}

function ReadOnlyRow({
  row,
  onEdit,
  onDeleted,
}: {
  row: CourseRow;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = React.useState(false);
  const confirmed = row.confirmed_by_student;

  const del = async () => {
    setDeleting(true);
    try {
      await deleteCourse(row.id);
      toast.success("Course removed");
      onDeleted();
    } catch (err) {
      toast.error("Remove failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <tr className="border-t border-border/60">
      <td className="px-3 py-2.5 font-mono text-xs">
        <div className="flex items-center gap-2">
          <span>{row.course_code ?? "—"}</span>
          {confirmed ? (
            <Badge variant="safe" title="Confirmed by you">
              <CheckCircle2 className="mr-0.5 size-3" />
              You
            </Badge>
          ) : (
            <Badge variant="muted" title="Auto-detected — click edit to confirm">
              Auto
            </Badge>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5">{row.title ?? <Muted>—</Muted>}</td>
      <td className="px-3 py-2.5">{row.grade ?? <Muted>—</Muted>}</td>
      <td className="px-3 py-2.5">
        {row.credits == null ? <Muted>—</Muted> : row.credits}
      </td>
      <td className="px-3 py-2.5">{row.semester ?? <Muted>—</Muted>}</td>
      <td className="px-3 py-2.5">
        <MatchBadge row={row} />
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onEdit}
            title="Edit"
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-[color:var(--color-verdict-significant)]/80 hover:text-[color:var(--color-verdict-significant)]"
            onClick={del}
            disabled={deleting}
            title="Delete"
          >
            {deleting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function EditingRow({
  row,
  onCancel,
  onSaved,
}: {
  row: CourseRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = React.useState({
    course_code: row.course_code ?? "",
    title: row.title ?? "",
    grade: row.grade ?? "",
    credits: row.credits == null ? "" : String(row.credits),
    semester: row.semester ?? "",
  });
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const credits =
        draft.credits.trim() === "" ? null : Number(draft.credits);
      await patchCourse(row.id, {
        course_code: draft.course_code.trim() || row.course_code || "",
        title: draft.title.trim() || null,
        grade: draft.grade.trim() || null,
        credits: Number.isFinite(credits) ? credits : null,
        semester: draft.semester.trim() || null,
        confirmed_by_student: true,
      });
      toast.success("Saved");
      onSaved();
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-t border-border/60 bg-lamp/5">
      <td className="px-3 py-2">
        <Input
          value={draft.course_code}
          onChange={(e) => setDraft({ ...draft, course_code: e.target.value })}
          className="h-8 font-mono text-xs"
        />
      </td>
      <td className="px-3 py-2">
        <Input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="h-8"
        />
      </td>
      <td className="px-3 py-2">
        <Input
          value={draft.grade}
          onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
          className="h-8 w-16"
        />
      </td>
      <td className="px-3 py-2">
        <Input
          value={draft.credits}
          onChange={(e) => setDraft({ ...draft, credits: e.target.value })}
          className="h-8 w-16"
          inputMode="decimal"
        />
      </td>
      <td className="px-3 py-2">
        <Input
          value={draft.semester}
          onChange={(e) => setDraft({ ...draft, semester: e.target.value })}
          className="h-8"
        />
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        <MatchBadge row={row} />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onCancel}
            disabled={saving}
            title="Cancel"
          >
            <X className="size-4" />
          </Button>
          <Button
            variant="lamp"
            size="icon"
            className="size-8"
            onClick={save}
            disabled={saving}
            title="Save"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function MatchBadge({ row }: { row: CourseRow }) {
  if (!row.catalog_course_id) {
    return (
      <Badge variant="watch" title="Not matched to catalog">
        <AlertCircle className="mr-0.5 size-3" />
        Unmatched
      </Badge>
    );
  }
  const conf = row.match_confidence ?? 0;
  const variant = conf >= 0.8 ? "safe" : conf >= 0.5 ? "lamp" : "watch";
  return (
    <Badge variant={variant} title={`Match confidence ${(conf * 100).toFixed(0)}%`}>
      {(conf * 100).toFixed(0)}%
    </Badge>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className={cn("text-muted-foreground")}>{children}</span>;
}
