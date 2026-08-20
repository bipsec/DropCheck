-- Phase 5 migration — advising-note integrity.
--
-- Copy-paste into Supabase SQL editor once. Idempotent — safe to re-run.
-- Requires phase2_migration.sql (which creates `advising_notes`) to have
-- been applied first; on a database without it every statement below
-- fails on the missing relation.
--
-- Two problems from live testing, both fixed here:
--
--   1. The advisor recorded an exploratory question ("I want to drop
--      CS 25000, give me options") as a settled decision. `stance` makes
--      the difference explicit, and the tool layer refuses to set
--      `outcome` unless stance = 'decided'.
--   2. A note written in error could not be withdrawn — the advisor had
--      to append a correction, leaving both versions in the eight notes
--      that resurface next session. `retracted_at` is a soft delete:
--      `readProfile` filters retracted rows out, but the row survives so
--      an advising record keeps its trail.

alter table advising_notes
    add column if not exists stance            text not null default 'exploring',
    add column if not exists retracted_at      timestamptz,
    add column if not exists retraction_reason text;

-- `add constraint` has no IF NOT EXISTS, so guard it to keep the script
-- re-runnable.
do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conname = 'advising_notes_stance_chk'
    ) then
        alter table advising_notes
            add constraint advising_notes_stance_chk
            check (stance in ('exploring', 'advised', 'decided'));
    end if;
end $$;

-- Every read is "this student's live notes, newest first" — the partial
-- index matches that predicate so retracted rows never enter the scan.
create index if not exists advising_notes_student_live_idx
    on advising_notes (student_id, created_at desc)
    where retracted_at is null;
