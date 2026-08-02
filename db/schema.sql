-- DropCheck — Supabase schema
-- Apply once via the Supabase SQL editor. Idempotent on re-run.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- Anonymous session-scoped student row.
create table if not exists students (
    id                      uuid primary key default gen_random_uuid(),
    session_id              text unique not null,
    name                    text,
    program                 text,
    major                   text,
    expected_grad_semester  text,
    gpa                     numeric,
    total_credits_completed numeric,
    future_plan             text,
    preferences             jsonb,
    international           boolean default false,
    created_at              timestamptz default now(),
    updated_at              timestamptz default now()
);

create index if not exists students_session_id_idx on students (session_id);

create table if not exists student_finance (
    student_id            uuid primary key references students(id) on delete cascade,
    tuition_per_term      numeric,
    current_aid_amount    numeric,
    aid_types             text[],
    sap_status            text,
    employment_hours_week integer,
    dependent_status      text,
    max_out_of_pocket     numeric,
    updated_at            timestamptz default now()
);

create table if not exists course_catalog (
    id                    uuid primary key default gen_random_uuid(),
    course_code           text unique not null,
    title                 text not null,
    description           text,
    credits               numeric,
    terms_offered         text[],
    prerequisites         text[],
    required_for_programs text[],
    level                 text,
    embedding             vector(1536),
    imported_at           timestamptz default now()
);

alter table course_catalog add column if not exists level text;

create index if not exists course_catalog_embedding_idx
    on course_catalog using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

create table if not exists transcripts (
    id              uuid primary key default gen_random_uuid(),
    student_id      uuid references students(id) on delete cascade,
    raw_file_path   text,
    parsed_markdown text,
    extraction_json jsonb,
    uploaded_at     timestamptz default now()
);

create index if not exists transcripts_student_id_idx on transcripts (student_id);

create table if not exists courses_taken (
    id                   uuid primary key default gen_random_uuid(),
    student_id           uuid references students(id) on delete cascade,
    catalog_course_id    uuid references course_catalog(id),
    course_code          text,
    title                text,
    grade                text,
    credits              numeric,
    semester             text,
    source               text default 'transcript_parse',
    confirmed_by_student boolean default false,
    match_confidence     numeric
);

create index if not exists courses_taken_student_id_idx on courses_taken (student_id);

create table if not exists conversations (
    id          uuid primary key default gen_random_uuid(),
    student_id  uuid references students(id) on delete cascade,
    course_code text,
    created_at  timestamptz default now()
);

create index if not exists conversations_student_id_idx on conversations (student_id);

create table if not exists conversation_turns (
    id              uuid primary key default gen_random_uuid(),
    conversation_id uuid references conversations(id) on delete cascade,
    role            text not null check (role in ('user', 'assistant')),
    query           text,
    response        jsonb,
    created_at      timestamptz default now()
);

create index if not exists conversation_turns_conv_idx on conversation_turns (conversation_id);

create table if not exists agent_traces (
    id                   uuid primary key default gen_random_uuid(),
    conversation_turn_id uuid references conversation_turns(id) on delete cascade,
    agent_name           text not null,
    step_order           integer not null,
    input_summary        text,
    output_summary       text,
    duration_ms          integer,
    created_at           timestamptz default now()
);

create index if not exists agent_traces_turn_idx on agent_traces (conversation_turn_id);

-- Row-level security is not needed for this app: every write goes through
-- the FastAPI backend using the service role key, and rows are already
-- scoped by student_id which the backend enforces. Explicitly disable RLS
-- so a mistakenly-configured anon key doesn't silently succeed on some
-- tables and fail on others.
alter table students             disable row level security;
alter table student_finance      disable row level security;
alter table course_catalog       disable row level security;
alter table transcripts          disable row level security;
alter table courses_taken        disable row level security;
alter table conversations        disable row level security;
alter table conversation_turns   disable row level security;
alter table agent_traces         disable row level security;

-- pgvector similarity search helper for catalog fuzzy match.
drop function if exists match_catalog_courses(vector, integer);
create or replace function match_catalog_courses(
    query_embedding vector(1536),
    match_count     integer default 5
)
returns table (
    id           uuid,
    course_code  text,
    title        text,
    description  text,
    credits      numeric,
    level        text,
    similarity   double precision
)
language sql stable as $$
    select
        c.id,
        c.course_code,
        c.title,
        c.description,
        c.credits,
        c.level,
        1 - (c.embedding <=> query_embedding) as similarity
    from course_catalog c
    where c.embedding is not null
    order by c.embedding <=> query_embedding
    limit match_count;
$$;
