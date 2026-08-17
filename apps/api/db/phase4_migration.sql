-- Phase 4 migration — Agent SDK session continuity.
--
-- Copy-paste into Supabase SQL editor once. Idempotent — safe to re-run.
-- One row per student holding the SDK session_id emitted on the first
-- turn. Subsequent turns pass this into `options.resume` so the agent
-- picks up where it left off, honoring NEW_Plan.md's "continuity
-- across the academic year" invariant.

create table if not exists session_state (
    student_id       uuid primary key references students(id) on delete cascade,
    sdk_session_id   text not null,
    updated_at       timestamptz default now()
);

alter table session_state disable row level security;
