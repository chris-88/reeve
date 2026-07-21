-- Phase 0: capture and triage.
-- Supabase is the system of record. No vault, no git, no local runner.

create type capture_status as enum ('queued', 'processing', 'done', 'failed');
create type capture_source as enum ('text');  -- 'voice' added if and when audio is earned

-- ---------------------------------------------------------------------------
-- areas
-- Config-driven so adding a life area is a row, not a code change.
-- classifier_hint is fed verbatim to the triage model and is the single
-- biggest lever on classification quality.
-- ---------------------------------------------------------------------------
create table areas (
  id              text primary key,       -- e.g. 'work', 'personal', 'unsorted'
  label           text not null,
  classifier_hint text not null,
  colour          text not null,
  sort_order      int  not null default 0,
  active          boolean not null default true
);

-- ---------------------------------------------------------------------------
-- captures
-- ---------------------------------------------------------------------------
create table captures (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  source      capture_source not null default 'text',
  raw_text    text not null check (length(trim(raw_text)) > 0),
  status      capture_status not null default 'queued',
  area_id     text references areas(id),
  title       text,
  summary     text,
  entities    jsonb,
  error       text,
  attempts    int not null default 0,
  -- Set when the user overrides the model's choice. This is the feedback signal
  -- that tells us whether the taxonomy is right; never overwrite it.
  corrected_area_id text references areas(id),
  corrected_at      timestamptz
);

create index captures_by_user_time on captures (user_id, created_at desc);
create index captures_by_area on captures (user_id, area_id) where area_id is not null;

-- ---------------------------------------------------------------------------
-- agent_runs
-- Audit log. One row per model call. Never deleted.
-- ---------------------------------------------------------------------------
create table agent_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  capture_id    uuid references captures(id) on delete cascade,
  step          text not null,
  model         text not null,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(10, 6),
  duration_ms   int,
  ok            boolean not null,
  error         text,
  created_at    timestamptz not null default now()
);

create index agent_runs_by_capture on agent_runs (capture_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create function set_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger captures_set_updated_at
  before update on captures
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- Single-user system today, but the policies are written properly now.
-- ---------------------------------------------------------------------------
alter table areas      enable row level security;
alter table captures   enable row level security;
alter table agent_runs enable row level security;

-- areas: any signed-in user reads; nobody writes from the client.
create policy areas_read on areas
  for select to authenticated using (true);

-- captures: owner-only. No delete policy — captures are not deleted.
create policy captures_select on captures
  for select to authenticated using (user_id = (select auth.uid()));
create policy captures_insert on captures
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy captures_update on captures
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- agent_runs: owner reads. Writes come from the Edge Function's secret key,
-- which bypasses RLS, so there is deliberately no insert policy.
create policy agent_runs_select on agent_runs
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime: the inbox watches rows move queued -> done in place.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table captures;

-- ---------------------------------------------------------------------------
-- Areas are seeded separately, not here.
--
-- Each area's classifier_hint describes a real part of the owner's life and is
-- fed verbatim to the triage model. That is personal content, so it lives in
-- supabase/seed/areas.json (gitignored) and is applied with `pnpm db:seed`.
-- See supabase/seed/areas.example.json for the shape.
-- ---------------------------------------------------------------------------
