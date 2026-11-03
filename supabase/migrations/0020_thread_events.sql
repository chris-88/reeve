-- Second edition, E2 (docs/spec.md §5 E-5): the thread is a view.
--
-- One screen that reads as a conversation needs one ordered feed of everything
-- that happened: what Chris said, what Reeve filed, what it proposed, what came
-- back, the morning's due list, the brief, and the bridge's notices. Nothing new
-- is stored for the thread itself; `thread_events` unions the existing tables
-- with a `happened_at` and the columns a message needs. The app reads it with
-- keyset pagination on (happened_at, id) and subscribes to realtime on the
-- underlying tables.
--
-- The one addition is `notices`: the due digest, "paused" and "stalled" had no
-- row anywhere (they were pushes only), so they could not appear in the thread
-- at all. A notice is a Reeve bubble with no decision attached.

create table if not exists notices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('due', 'paused', 'stalled')),
  body       text not null,
  -- due: { items: [{ id, text, due_at }], today, overdue }; stalled: { action_id }
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists notices_by_user_time on notices (user_id, created_at desc);

alter table notices enable row level security;
drop policy if exists notices_select on notices;
create policy notices_select on notices for select using (auth.uid() = user_id);
-- Inserts come from the service role (notify-due, the bridge) and from
-- security-definer functions; no client policy on purpose.

-- Indexes the keyset needs on the branches that lacked one.
create index if not exists actions_by_user_time on actions (user_id, updated_at desc);
create index if not exists agent_runs_by_user_capture on agent_runs (user_id, capture_id, created_at desc);

-- Realtime for the two tables the thread reads that were not published.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'briefs') then
    alter publication supabase_realtime add table briefs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notices') then
    alter publication supabase_realtime add table notices;
  end if;
end $$;

drop view if exists thread_events;
create view thread_events
with (security_invoker = true) as
-- you: what you said, when you said it
select
  'capture:' || c.id                              as id,
  c.user_id,
  c.created_at                                    as happened_at,
  'capture'::text                                 as kind,
  c.id                                            as ref_id,
  c.id                                            as capture_id,
  c.title,
  c.raw_text                                      as body,
  coalesce(c.corrected_area_id, c.area_id)        as domain,
  c.status::text                                  as status,
  null::text                                      as result,
  null::text[]                                    as result_files,
  null::text                                      as feedback,
  c.filed_path,
  c.archived_at,
  jsonb_build_object('summary', c.summary, 'error', c.error, 'attempts', c.attempts) as meta
from captures c

union all

-- Reeve: "Filed under home: …", at the moment triage finished. Triage inserts
-- the proposed action before it logs its run, so the filed line is pinned a
-- millisecond ahead of the earliest action: "Filed…" reads before "I could…".
select
  'filed:' || c.id,
  c.user_id,
  least(r.created_at, (select min(a.created_at) from actions a where a.capture_id = c.id)) - interval '1 millisecond',
  'filed',
  c.id,
  c.id,
  c.title,
  c.summary,
  coalesce(c.corrected_area_id, c.area_id),
  c.status::text,
  null, null, null,
  c.filed_path,
  c.archived_at,
  jsonb_build_object(
    'commitments', (
      select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'text', k.text, 'due_at', k.due_at, 'due_text', k.due_text, 'status', k.status) order by k.created_at), '[]'::jsonb)
      from commitments k where k.capture_id = c.id
    ),
    'actions', (select count(*) from actions a where a.capture_id = c.id and a.kind = 'task')
  )
from captures c
join lateral (
  select created_at from agent_runs r
  where r.capture_id = c.id and r.step = 'triage' and r.ok
  order by r.created_at desc limit 1
) r on true
where c.status = 'done'

union all

-- Reeve: "I couldn't file this" (triage exhausted its attempts)
select
  'capture-failed:' || c.id,
  c.user_id,
  c.updated_at,
  'capture_failed',
  c.id,
  c.id,
  c.title,
  c.error,
  coalesce(c.corrected_area_id, c.area_id),
  c.status::text,
  null, null, null,
  c.filed_path,
  c.archived_at,
  '{}'::jsonb
from captures c
where c.status = 'failed'

union all

-- Reeve: an action is one message that changes state in place; it sits in the
-- thread where it last changed (proposed → on it → result → approved)
select
  'action:' || a.id,
  a.user_id,
  case a.status
    when 'proposed'   then a.created_at
    when 'dispatched' then coalesce(a.dispatched_at, a.updated_at)
    when 'working'    then coalesce(a.started_at, a.updated_at)
    when 'review'     then a.updated_at
    else                   coalesce(a.decided_at, a.updated_at)
  end,
  'action',
  a.id,
  a.capture_id,
  a.title,
  a.brief,
  a.area_id,
  a.status::text,
  a.result,
  a.result_files,
  a.feedback,
  null,
  a.archived_at,
  jsonb_build_object('kind', a.kind, 'assignee', a.assignee, 'created_at', a.created_at,
                     'dispatched_at', a.dispatched_at, 'decided_at', a.decided_at)
from actions a

union all

-- you: the note that travelled with a Redo
select
  'redo:' || a.id,
  a.user_id,
  a.dispatched_at,
  'redo_note',
  a.id,
  a.capture_id,
  a.title,
  a.feedback,
  a.area_id,
  a.status::text,
  null, null, null, null,
  a.archived_at,
  '{}'::jsonb
from actions a
where a.feedback is not null and a.dispatched_at is not null

union all

-- Reeve: the morning brief
select
  'brief:' || b.id,
  b.user_id,
  b.created_at,
  'brief',
  b.id,
  null,
  'Today',
  b.body,
  null, null, null, null, null, null, null,
  jsonb_build_object('period_start', b.period_start, 'period_end', b.period_end)
from briefs b

union all

-- Reeve: due digest, paused, stalled
select
  'notice:' || n.id,
  n.user_id,
  n.created_at,
  n.kind,
  n.id,
  (n.meta ->> 'capture_id')::uuid,
  null,
  n.body,
  null, null, null, null, null, null, null,
  n.meta
from notices n;

comment on view thread_events is 'E-5: the thread. One row per message; keyset on (happened_at, id).';

-- PN-7.2 / E-4: the stall alert also leaves a notice in the thread, and its
-- deep link is the action's message.
create or replace function report_stuck_actions()
returns integer
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  push_url    text;
  service_key text;
  reported    int := 0;
  r           record;
begin
  select decrypted_secret into push_url
    from vault.decrypted_secrets where name = 'send_push_function_url';
  select decrypted_secret into service_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if push_url is null or service_key is null then
    raise warning 'report_stuck_actions: vault secrets missing, nothing reported';
    return 0;
  end if;

  for r in
    select id, user_id, capture_id, title
      from actions
     where status = 'dispatched'
       and archived_at is null
       and dispatched_at < now() - interval '30 minutes'
       and (stuck_alerted_at is null or stuck_alerted_at < dispatched_at)
     order by dispatched_at
     limit 20
  loop
    insert into notices (user_id, kind, body, meta)
    values (r.user_id, 'stalled',
            'I haven''t picked this up yet: ' || r.title || '. Is the machine awake?',
            jsonb_build_object('action_id', r.id, 'capture_id', r.capture_id));
    perform net.http_post(
      url     := push_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || service_key
                 ),
      body    := jsonb_build_object(
                   'user_id', r.user_id,
                   'notification', jsonb_build_object(
                     'title', 'Reeve hasn''t picked this up',
                     'body',  r.title,
                     'url',   '/#/m/action:' || r.id,
                     'tag',   'bridge'
                   )
                 ),
      timeout_milliseconds := 15000
    );
    update actions set stuck_alerted_at = now() where id = r.id;
    reported := reported + 1;
  end loop;

  return reported;
end;
$$;
