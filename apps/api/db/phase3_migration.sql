-- Phase 3 migration — Purdue.io course cache.
--
-- Copy-paste into Supabase SQL editor once. Idempotent — safe to re-run.
-- Cache TTL is one term (api.purdue.io data changes termly at most).
-- The `prerequisites_hint` column carries the low-confidence regex scrape
-- from the free-text description — see purdueClient.extractPrereqHints.
-- The rules engine never treats this array as ground truth.

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

alter table course_cache disable row level security;
