-- Commissioner Assistant — Supabase schema
-- Run this once in the Supabase SQL editor for a new project.
-- See SETUP.md for the full setup walkthrough.
--
-- RLS is left off on all three tables on purpose: the only thing that ever
-- talks to Supabase is our own server-side code in api/, authenticated with
-- the service role key (which bypasses RLS anyway) and gated by the
-- x-api-key check in api/_lib/supabase.js. That check is the real access
-- control here, not Postgres row-level security — RLS would just be
-- redundant complexity for a single-tenant tool with no direct client access.

create table if not exists dues_state (
  sleeper_league_id text not null,
  season text not null,
  dues_amount numeric not null default 0,
  payouts jsonb not null default '{}'::jsonb,
  paid jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sleeper_league_id, season)
);

-- Generic cache for expensive, fully-Sleeper-derived computed results.
-- 'kind' distinguishes what computed it (history.js vs stats.js today);
-- add more kinds later without adding new tables. Only ever holds seasons
-- Sleeper reports as status: "complete" — the in-progress season is never
-- cached here since it isn't done changing yet.
create table if not exists season_cache (
  sleeper_league_id text not null,
  season text not null,
  kind text not null,
  data jsonb not null,
  cached_at timestamptz not null default now(),
  primary key (sleeper_league_id, season, kind)
);

-- Generic site-wide key/value settings, starting with "current_league_id"
-- (set from league.html, read by every other page so you don't have to
-- re-paste the league ID everywhere) — new settings later don't need new
-- tables, same philosophy as season_cache's 'kind' column above.
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table dues_state disable row level security;
alter table season_cache disable row level security;
alter table app_settings disable row level security;
