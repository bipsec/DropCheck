-- Phase 0 teardown migration.
--
-- Copy-paste into Supabase SQL editor once. Idempotent — safe to re-run.
-- Drops every table the DropCheck v1 pipeline used but the Academic
-- Companion architecture doesn't need. Cascades to child rows via the
-- existing FK constraints, so any straggler content in these tables is
-- also removed.
--
-- Tables that STAY (used by phases 2+): students, courses_taken,
-- student_waivers, student_transfers.
--
-- Tables that GO: student_finance (aid impact was v1-only), transcripts
-- (PDF ingest deleted), conversations + conversation_turns + agent_traces
-- (chat replaces the old REST turn model), course_catalog + its RPC +
-- ivfflat index (Purdue.io cache lands in Phase 3 as `course_cache`).

drop function if exists match_catalog_courses(vector, integer);
drop index if exists course_catalog_embedding_idx;

drop table if exists agent_traces          cascade;
drop table if exists conversation_turns    cascade;
drop table if exists conversations         cascade;
drop table if exists transcripts           cascade;
drop table if exists student_finance       cascade;
drop table if exists course_catalog        cascade;
