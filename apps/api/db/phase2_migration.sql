-- Phase 2 migration — profile & memory MCP server.
--
-- Copy-paste into Supabase SQL editor once. Idempotent — safe to re-run.
-- Adds one table: `advising_notes`. Every time the advisor talks a
-- student through a decision, it writes a note here so the reasoning
-- surfaces in `get_student_profile` on the next visit — that's what
-- gives the system continuity across the academic year.

create table if not exists advising_notes (
    id          uuid primary key default gen_random_uuid(),
    student_id  uuid references students(id) on delete cascade,
    topic       text not null,
    reasoning   text not null,
    outcome     text,
    created_at  timestamptz default now()
);

create index if not exists advising_notes_student_recent_idx
    on advising_notes (student_id, created_at desc);

alter table advising_notes disable row level security;
