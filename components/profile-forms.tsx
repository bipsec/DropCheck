"use client";

import * as React from "react";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { patchProfile } from "@/lib/api";
import type { ProfileOut, StudentRow, FinanceRow } from "@/lib/api-types";

// ---------------------------------------------------------------------------
// Shared helpers
//
// Turn "" back into null before sending — the backend distinguishes "cleared"
// from "unchanged" and Pydantic rejects empty-string numerics. `undefined` is
// dropped via `exclude_unset` on the server, so it lets a student's edit
// survive unchanged fields.

function numOrNull(v: string): number | null | undefined {
  const trimmed = v.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(v: string | null | undefined): string | null {
  if (v === undefined) return null;
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

// A tiny local "form controller" — tracks the diff between the input state
// and the last-saved value so we can enable/disable "Save" and reset after
// a successful PATCH.
//
// IMPORTANT: the parent passes `seed` as a fresh object literal on every
// render (studentToDraft/financeToDraft/preferencesToDraft). Depending on
// its identity would cause an infinite render loop, so we key the effect
// on a stable serialization instead. Only actual content changes push a
// new baseline into local state — round-trips through PATCH → parent
// setProfile → same values re-seeded end up as a no-op.
function useFormDraft<T extends Record<string, unknown>>(seed: T) {
  const [draft, setDraft] = React.useState<T>(seed);
  const [baseline, setBaseline] = React.useState<T>(seed);
  const seedKey = React.useMemo(() => JSON.stringify(seed), [seed]);
  React.useEffect(() => {
    setDraft(seed);
    setBaseline(seed);
    // seedKey encodes seed's content; ignore ESLint's identity-based warning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);
  const dirty = React.useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline]
  );
  const commit = (next: T) => {
    setDraft(next);
    setBaseline(next);
  };
  const update = <K extends keyof T>(key: K, value: T[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  return { draft, update, dirty, commit };
}

type PanelProps = {
  profile: ProfileOut;
  onUpdated: (next: ProfileOut) => void;
};

// ---------------------------------------------------------------------------
// Academic

type AcademicDraft = {
  name: string;
  program: string;
  major: string;
  expected_grad_semester: string;
  gpa: string;
  total_credits_completed: string;
  international: "yes" | "no" | "unknown";
};

function studentToDraft(s: StudentRow): AcademicDraft {
  return {
    name: s.name ?? "",
    program: s.program ?? "",
    major: s.major ?? "",
    expected_grad_semester: s.expected_grad_semester ?? "",
    gpa: s.gpa == null ? "" : String(s.gpa),
    total_credits_completed:
      s.total_credits_completed == null ? "" : String(s.total_credits_completed),
    international: s.international === true ? "yes" : s.international === false ? "no" : "unknown",
  };
}

export function AcademicPanel({ profile, onUpdated }: PanelProps) {
  const { draft, update, dirty, commit } = useFormDraft<AcademicDraft>(
    studentToDraft(profile.student)
  );
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const patch = {
        student: {
          name: textOrNull(draft.name),
          program: textOrNull(draft.program),
          major: textOrNull(draft.major),
          expected_grad_semester: textOrNull(draft.expected_grad_semester),
          gpa: numOrNull(draft.gpa),
          total_credits_completed: numOrNull(draft.total_credits_completed),
          international:
            draft.international === "unknown"
              ? null
              : draft.international === "yes",
        },
      };
      const next = await patchProfile(patch);
      onUpdated(next);
      commit(studentToDraft(next.student));
      toast.success("Academic fields saved");
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Jane Ada Rivera"
            />
          </Field>
          <Field label="Program">
            <Input
              value={draft.program}
              onChange={(e) => update("program", e.target.value)}
              placeholder="Bachelor of Science, Computer Science"
            />
          </Field>
          <Field label="Major">
            <Input
              value={draft.major}
              onChange={(e) => update("major", e.target.value)}
              placeholder="cs"
            />
          </Field>
          <Field label="Expected graduation semester">
            <Input
              value={draft.expected_grad_semester}
              onChange={(e) => update("expected_grad_semester", e.target.value)}
              placeholder="Spring 2027"
            />
          </Field>
          <Field label="GPA">
            <Input
              inputMode="decimal"
              value={draft.gpa}
              onChange={(e) => update("gpa", e.target.value)}
              placeholder="3.42"
            />
          </Field>
          <Field label="Total credits completed">
            <Input
              inputMode="numeric"
              value={draft.total_credits_completed}
              onChange={(e) => update("total_credits_completed", e.target.value)}
              placeholder="68"
            />
          </Field>
          <Field label="International student" span2>
            <RadioRow
              value={draft.international}
              onChange={(v) => update("international", v)}
              options={[
                { value: "no", label: "Domestic" },
                { value: "yes", label: "International (F-1)" },
                { value: "unknown", label: "Not sure" },
              ]}
            />
          </Field>
        </div>
        <SaveRow dirty={dirty} saving={saving} onSave={save} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Finance

type FinanceDraft = {
  tuition_per_term: string;
  current_aid_amount: string;
  aid_types: string; // comma-separated on the wire; parsed at save time
  sap_status: "good" | "warning" | "probation" | "";
  employment_hours_week: string;
  dependent_status: "dependent" | "independent" | "";
  max_out_of_pocket: string;
};

function financeToDraft(f: FinanceRow | null): FinanceDraft {
  return {
    tuition_per_term: f?.tuition_per_term == null ? "" : String(f.tuition_per_term),
    current_aid_amount:
      f?.current_aid_amount == null ? "" : String(f.current_aid_amount),
    aid_types: f?.aid_types?.join(", ") ?? "",
    sap_status: f?.sap_status ?? "",
    employment_hours_week:
      f?.employment_hours_week == null ? "" : String(f.employment_hours_week),
    dependent_status: f?.dependent_status ?? "",
    max_out_of_pocket:
      f?.max_out_of_pocket == null ? "" : String(f.max_out_of_pocket),
  };
}

export function FinancePanel({ profile, onUpdated }: PanelProps) {
  const { draft, update, dirty, commit } = useFormDraft<FinanceDraft>(
    financeToDraft(profile.finance)
  );
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const aidList = draft.aid_types
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const patch = {
        finance: {
          tuition_per_term: numOrNull(draft.tuition_per_term),
          current_aid_amount: numOrNull(draft.current_aid_amount),
          aid_types: aidList.length ? aidList : null,
          sap_status: (draft.sap_status || null) as "good" | "warning" | "probation" | null,
          employment_hours_week: numOrNull(draft.employment_hours_week) as number | null,
          dependent_status: (draft.dependent_status || null) as "dependent" | "independent" | null,
          max_out_of_pocket: numOrNull(draft.max_out_of_pocket),
        },
      };
      const next = await patchProfile(patch);
      onUpdated(next);
      commit(financeToDraft(next.finance));
      toast.success("Finance fields saved");
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Tuition per term ($)">
            <Input
              inputMode="numeric"
              value={draft.tuition_per_term}
              onChange={(e) => update("tuition_per_term", e.target.value)}
              placeholder="14850"
            />
          </Field>
          <Field label="Total aid per term ($)">
            <Input
              inputMode="numeric"
              value={draft.current_aid_amount}
              onChange={(e) => update("current_aid_amount", e.target.value)}
              placeholder="8000"
            />
          </Field>
          <Field
            label="Aid types (comma-separated)"
            hint="e.g. pell, subsidized loan, institutional grant"
            span2
          >
            <Input
              value={draft.aid_types}
              onChange={(e) => update("aid_types", e.target.value)}
              placeholder="pell, subsidized loan"
            />
          </Field>
          <Field label="SAP status">
            <RadioRow
              value={draft.sap_status}
              onChange={(v) => update("sap_status", v)}
              options={[
                { value: "", label: "Unknown" },
                { value: "good", label: "Good" },
                { value: "warning", label: "Warning" },
                { value: "probation", label: "Probation" },
              ]}
            />
          </Field>
          <Field label="Dependent status">
            <RadioRow
              value={draft.dependent_status}
              onChange={(v) => update("dependent_status", v)}
              options={[
                { value: "", label: "Unknown" },
                { value: "dependent", label: "Dependent" },
                { value: "independent", label: "Independent" },
              ]}
            />
          </Field>
          <Field label="Employment hours / week">
            <Input
              inputMode="numeric"
              value={draft.employment_hours_week}
              onChange={(e) => update("employment_hours_week", e.target.value)}
              placeholder="15"
            />
          </Field>
          <Field label="Max out-of-pocket ($)">
            <Input
              inputMode="numeric"
              value={draft.max_out_of_pocket}
              onChange={(e) => update("max_out_of_pocket", e.target.value)}
              placeholder="6000"
            />
          </Field>
        </div>
        <SaveRow dirty={dirty} saving={saving} onSave={save} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Preferences

type PreferencesDraft = {
  future_plan: string;
  prioritize: "graduate_fast" | "workload_balance" | "grade_recovery" | "";
};

function preferencesToDraft(s: StudentRow): PreferencesDraft {
  const priorRaw = s.preferences?.prioritize;
  const prior = typeof priorRaw === "string" ? priorRaw : "";
  return {
    future_plan: s.future_plan ?? "",
    prioritize: (prior === "graduate_fast" || prior === "workload_balance" || prior === "grade_recovery"
      ? prior
      : "") as PreferencesDraft["prioritize"],
  };
}

export function PreferencesPanel({ profile, onUpdated }: PanelProps) {
  const { draft, update, dirty, commit } = useFormDraft<PreferencesDraft>(
    preferencesToDraft(profile.student)
  );
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const preferences = draft.prioritize
        ? { prioritize: draft.prioritize }
        : null;
      const next = await patchProfile({
        student: {
          future_plan: textOrNull(draft.future_plan),
          preferences,
        },
      });
      onUpdated(next);
      commit(preferencesToDraft(next.student));
      toast.success("Preferences saved");
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-5">
          <Field
            label="Future plan / career interest"
            hint="A sentence about what you're aiming for — grad school in ML, industry SWE, med school, etc. The agent uses this to score course importance."
          >
            <Textarea
              value={draft.future_plan}
              onChange={(e) => update("future_plan", e.target.value)}
              placeholder="Grad school in machine learning."
              rows={3}
            />
          </Field>
          <Field label="If we had to prioritize one thing…">
            <RadioRow
              value={draft.prioritize}
              onChange={(v) => update("prioritize", v)}
              options={[
                { value: "", label: "Not sure" },
                { value: "graduate_fast", label: "Graduate fast" },
                { value: "workload_balance", label: "Workload balance" },
                { value: "grade_recovery", label: "Grade recovery" },
              ]}
            />
          </Field>
        </div>
        <SaveRow dirty={dirty} saving={saving} onSave={save} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Field / RadioRow / SaveRow

function Field({
  label,
  hint,
  span2,
  children,
}: {
  label: string;
  hint?: string;
  span2?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : undefined}>
      <Label className="block">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function RadioRow<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            type="button"
            key={opt.value || "_"}
            onClick={() => onChange(opt.value)}
            className={[
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-lamp bg-lamp/10 text-foreground"
                : "border-border text-muted-foreground hover:border-lamp/40 hover:text-foreground",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SaveRow({
  dirty,
  saving,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-end gap-3">
      {dirty ? (
        <span className="text-xs text-muted-foreground">Unsaved changes</span>
      ) : (
        <span className="text-xs text-muted-foreground">All saved</span>
      )}
      <Button
        variant="lamp"
        onClick={onSave}
        disabled={!dirty || saving}
        className="min-w-24"
      >
        {saving ? (
          <>
            <Loader2 className="animate-spin" />
            Saving…
          </>
        ) : (
          <>
            <Save className="mr-1 size-4" />
            Save
          </>
        )}
      </Button>
    </div>
  );
}
