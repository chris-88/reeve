-- P1-F1: commitments as first-class rows.
--
-- `entities.commitments` was a text[] inside a jsonb column: the one thing the
-- model extracts that implies an action, stored in the one shape that cannot
-- be sorted by date, marked done, counted or joined. "What did I say I would
-- do this week?" meant fetching every capture and reducing in JavaScript.
--
-- Nothing here adds model capability. It makes output triage already produces
-- usable.

create type commitment_status as enum ('open', 'done', 'dropped');

create table commitments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  capture_id   uuid not null references captures(id) on delete cascade,
  area_id      text,
  text         text not null check (length(trim(text)) > 0),
  -- The verbatim date phrase as captured ("next Tuesday", "end of the month")
  -- alongside the resolved timestamp. Keeping both follows the same reasoning
  -- as corrected_area_id: never destroy the original signal in favour of the
  -- machine's interpretation of it.
  due_text     text,
  due_at       timestamptz,
  status       commitment_status not null default 'open',
  completed_at timestamptz,
  origin       text not null default 'model' check (origin in ('model','user')),
  -- Stable hash of (capture_id, normalised text). Makes re-triage idempotent —
  -- see packages/shared/src/commitments.ts, which is the only place it is
  -- computed so that the Edge Function and the backfill script cannot drift.
  fingerprint  text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Composite, matching captures since 0003: a commitment cannot be filed
  -- under an area belonging to someone else.
  foreign key (user_id, area_id) references areas (owner_id, id)
);

create unique index commitments_fingerprint on commitments (fingerprint);
create index commitments_due on commitments (user_id, status, due_at);
create index commitments_by_capture on commitments (capture_id);

create trigger commitments_set_updated_at
  before update on commitments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Owner-scoped, and deliberately no delete policy. A commitment that no longer
-- applies moves to status 'dropped'. The reasoning docs/spec.md gives for never
-- losing a capture applies with equal force to a thing the user said they would
-- do: the record of having dropped it is itself worth having.
--
-- Inserts come from the Edge Function's secret key, which bypasses RLS. The
-- insert policy exists for P1-F1.6's backfill and for any future client-side
-- creation; the with-check clause is what makes it safe.
-- ---------------------------------------------------------------------------
alter table commitments enable row level security;

create policy commitments_select on commitments
  for select to authenticated using (user_id = (select auth.uid()));
create policy commitments_insert on commitments
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy commitments_update on commitments
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime: the Due view updates in place the way the inbox does, so a
-- commitment extracted from a capture taken seconds ago appears without a
-- refresh.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table commitments;
