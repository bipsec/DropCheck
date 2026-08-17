-- Academic Companion — Supabase schema (post Phase 0).
--
-- Apply once via the Supabase SQL editor. Idempotent on re-run. Later
-- phases add tables via their own `dbN_migration.sql` snippets rather
-- than growing this file — this stays the canonical "fresh install"
-- baseline.
--
-- pgvector is kept as an extension because a future phase may wire
-- semantic search over the Purdue course cache, even though the
-- teardown removed the old ivfflat index.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- --- Students -------------------------------------------------------------
-- Anonymous session-scoped row. HMAC-signed cookie -> `session_id` ->
-- one row here. The `program_id` / `entry_type` / `target_grad_term` /
-- `max_credits_per_term` / `institution_id` columns are consumed by the
-- rules-engine MCP tools (phase 1).

create table if not exists students (
    id                       uuid primary key default gen_random_uuid(),
    session_id               text unique not null,
    name                     text,
    program                  text,
    major                    text,
    expected_grad_semester   text,
    gpa                      numeric,
    total_credits_completed  numeric,
    future_plan              text,
    preferences              jsonb,
    international            boolean default false,
    program_id               text,
    entry_type               text,
    target_grad_term         text,
    max_credits_per_term     integer,
    institution_id           text default 'generic',
    created_at               timestamptz default now(),
    updated_at               timestamptz default now()
);

create index if not exists students_session_id_idx on students (session_id);

-- --- Completed / in-progress courses -------------------------------------
-- `source` is one of transcript / manual / waiver / transfer per
-- updated_plan.md §2.4. `is_in_progress` flips true for courses the
-- student is currently enrolled in but hasn't yet graded.

create table if not exists courses_taken (
    id                    uuid primary key default gen_random_uuid(),
    student_id            uuid references students(id) on delete cascade,
    course_code           text,
    title                 text,
    grade                 text,
    credits               numeric,
    semester              text,
    source                text default 'manual',
    confirmed_by_student  boolean default false,
    is_in_progress        boolean default false,
    match_confidence      numeric
);

create index if not exists courses_taken_student_id_idx on courses_taken (student_id);

-- --- Waivers (student-confirmed exemptions) ------------------------------

create table if not exists student_waivers (
    id           uuid primary key default gen_random_uuid(),
    student_id   uuid references students(id) on delete cascade,
    course_code  text not null,
    note         text,
    created_at   timestamptz default now(),
    unique (student_id, course_code)
);
create index if not exists student_waivers_student_id_idx
    on student_waivers (student_id);

-- --- Transfer credits ----------------------------------------------------

create table if not exists student_transfers (
    id                       uuid primary key default gen_random_uuid(),
    student_id               uuid references students(id) on delete cascade,
    external_course          text not null,
    equivalent_course_code   text not null,
    credits                  numeric not null,
    created_at               timestamptz default now()
);
create index if not exists student_transfers_student_id_idx
    on student_transfers (student_id);

-- --- Purdue.io course cache (Phase 3) ------------------------------------
-- Write-through cache for api.purdue.io lookups. Cache TTL = one term.
-- `prerequisites_hint` is a low-confidence regex scrape of the free-text
-- description; the rules engine never treats it as ground truth.

create table if not exists course_cache (
    course_code                text primary key,
    subject                    text not null,
    number                     text not null,
    title                      text not null,
    credits                    numeric,
    description                text,
    prerequisites_hint         text[] default '{}',
    prerequisites_confidence   text default 'low_unstructured_hint',
    terms_seen_historically    text[] default '{}',
    source                     text default 'purdue_io_odata',
    source_course_id           text,
    fetched_at                 timestamptz default now()
);
create index if not exists course_cache_subject_idx on course_cache (subject);

-- --- SDK session state (Phase 4) -----------------------------------------
-- One row per student; the SDK's session_id emitted on turn 1 is
-- persisted so future turns pass `options.resume` and pick up the
-- accumulated conversation context.

create table if not exists session_state (
    student_id       uuid primary key references students(id) on delete cascade,
    sdk_session_id   text not null,
    updated_at       timestamptz default now()
);

-- --- Advising notes (Phase 2) --------------------------------------------
-- The advisor writes one row per meaningful conversation turn — topic +
-- reasoning + optional outcome — so future sessions can pick up where
-- previous ones left off.

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

-- --- RLS ------------------------------------------------------------------
-- Every write goes through the Next.js server using the service-role
-- key, and each query is scoped by student_id at the query layer.
-- Disable RLS explicitly so a mistakenly-configured anon key doesn't
-- silently succeed on some tables and fail on others.

alter table students          disable row level security;
alter table courses_taken     disable row level security;
alter table student_waivers   disable row level security;
alter table student_transfers disable row level security;
alter table advising_notes    disable row level security;
alter table course_cache      disable row level security;
alter table session_state     disable row level security;
