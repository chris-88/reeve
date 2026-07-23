-- AQ-1: the attention queue's substrate — actions, and a soft-delete for captures.
--
-- Captures stay immutable records. An actionable capture is *promoted* into an
-- action — a thing Reeve proposes to do — carried through a decision lifecycle,
-- the same promotion pattern as commitments (0004) and change_requests (0012).
--
-- The pivot from the earlier board draft is visible here as an absence: there
-- is NO `position` column. Priority is computed and proposed (AQ-3), never
-- hand-ordered. The human's job is judgment, not arranging tickets.

-- ---------------------------------------------------------------------------
-- Soft-delete for the Search / reference view (AQ-6).
--
-- `if not exists` because this column may already be present: the reconciled
-- 0014_tasks migration added it before the pivot. Archiving is an UPDATE,
-- already permitted by captures_update (0001); hard delete stays disallowed.
-- ---------------------------------------------------------------------------
alter table captures add column if not exists archived_at timestamptz;

-- ---------------------------------------------------------------------------
-- Actions — a proposed action Reeve can take on a capture's behalf, and the
-- decision lifecycle it moves through. The two states that need a human —
-- 'proposed' and 'review' — are the "Needs you" stream.
-- ---------------------------------------------------------------------------
create type action_status as enum (
  'proposed',   -- AI drafted it; awaiting Go / Tweak / decline    -> in Needs you
  'dispatched', -- Chris said Go; handed to an agent (manual for now)
  'review',     -- agent returned a result; awaiting Approve / Redo -> in Needs you
  'done',       -- approved and complete
  'declined'    -- "just a note"; the capture stays filed as reference
);

create table actions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  capture_id    uuid not null references captures(id) on delete cascade,
  -- What Reeve proposes to do; editable via Tweak.
  title         text not null check (length(trim(title)) > 0),
  -- The drafted action / handoff an agent receives (AQ-4). Null until Go.
  brief         text,
  status        action_status not null default 'proposed',
  area_id       text,
  -- The one manual lever (AQ-3): "Do next". Null means AI order.
  pinned_at     timestamptz,
  -- What the agent returned, awaiting approval (AQ-5).
  result        text,
  dispatched_at timestamptz,
  -- When done or declined.
  decided_at    timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Composite, matching captures (0003) and commitments (0004): an action
  -- cannot carry an area belonging to someone else. A null area_id satisfies
  -- MATCH SIMPLE, which is what an unfiled capture's action looks like.
  foreign key (user_id, area_id) references areas (owner_id, id)
);

-- Needs you = the two states that require a human. Partial, because that is the
-- only query the stream makes and the rest of the lifecycle is cold by then.
create index actions_needs_you on actions (user_id, status)
  where archived_at is null and status in ('proposed', 'review');
-- One action per capture (AQ-3's producer is idempotent on re-triage); this
-- keeps the "does this capture already have an action" check cheap.
create index actions_by_capture on actions (capture_id);

create trigger actions_set_updated_at
  before update on actions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security. Owner-scoped, and no delete policy — an action is
-- archived or declined, never deleted, like everything else in this schema.
-- ---------------------------------------------------------------------------
alter table actions enable row level security;

create policy actions_select on actions
  for select to authenticated using (user_id = (select auth.uid()));
create policy actions_insert on actions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy actions_update on actions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Realtime: an action decided on the phone leaves the stream on the laptop
-- without a refresh, the way commitments already do.
alter publication supabase_realtime add table actions;
