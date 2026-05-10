-- ============================================================
-- StudyAI — Supabase Schema  (JWT-only, no Auth.js adapter)
-- Run this entire file in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- ============================================================
-- user_id stores Google's OAuth "sub" string (e.g. "116302...")
-- which comes from the Auth.js JWT token — no adapter tables needed.
-- ============================================================

-- ── App tables (public schema) ──────────────────────────────

-- Learner profiles: one row per user
create table if not exists public.learner_profiles (
  id                   uuid primary key default gen_random_uuid(),
  user_id              text not null,
  overall_level        text not null default 'intermediate',
  quiz_history         jsonb not null default '[]'::jsonb,
  chat_tone            text not null default 'peer-level',
  checked_in_lectures  text[] not null default '{}',
  updated_at           timestamptz default now(),
  unique (user_id)
);

-- Saved lectures: one row per (user, video)
create table if not exists public.saved_lectures (
  id              text not null,   -- YouTube videoId
  user_id         text not null,
  title           text not null,
  channel_name    text not null,
  thumbnail_url   text,
  result          jsonb not null,
  study_materials jsonb not null,
  chat_history    jsonb not null default '[]'::jsonb,
  saved_at        timestamptz default now(),
  primary key (id, user_id)
);

-- Lecture progress: one row per (user, video)
create table if not exists public.lecture_progress (
  video_id    text not null,
  user_id     text not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now(),
  primary key (video_id, user_id)
);

-- ── Row-Level Security ───────────────────────────────────────
-- All DB access goes through the service-role key on the server
-- (never the anon key directly from the browser), so "true" RLS
-- policies are safe — the server enforces user_id filtering.

alter table public.learner_profiles enable row level security;
alter table public.saved_lectures    enable row level security;
alter table public.lecture_progress  enable row level security;

create policy "service_role bypass learner_profiles"
  on public.learner_profiles for all using (true) with check (true);

create policy "service_role bypass saved_lectures"
  on public.saved_lectures for all using (true) with check (true);

create policy "service_role bypass lecture_progress"
  on public.lecture_progress for all using (true) with check (true);

-- ── Indexes ──────────────────────────────────────────────────

create index if not exists learner_profiles_user_id_idx on public.learner_profiles(user_id);
create index if not exists saved_lectures_user_id_idx   on public.saved_lectures(user_id);
create index if not exists lecture_progress_user_id_idx on public.lecture_progress(user_id);
