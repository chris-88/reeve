-- The bridge (docs/arc-spec-bridge.md): a worker on the quinn machine claims
-- dispatched actions, runs them headlessly, and returns the result to review.
-- Three small additions carry it; the claim itself needs nothing new because
-- 0015's partial index already covers the Queued lane.

-- BR-6.1: what kind of work an action is. A `task` waits for Go and is run by
-- the bridge once dispatched. A `decompose` is proposed by triage for a mind
-- dump (three or more distinct intents) and is picked up without Go, because
-- decomposing is drafting: it only ever creates more *proposed* actions,
-- commitments and notes, every one of which still needs Go.
create type action_kind as enum ('task', 'decompose');
alter table actions add column kind action_kind not null default 'task';

-- BR-5.1: what Chris said on Redo. Without it the second pass is blind. Left in
-- place by Approve and by the next pickup; the next Redo overwrites it.
alter table actions add column feedback text;

-- BR-1.1: wake the worker the moment there is something to claim, instead of
-- waiting for its 20-second poll. The payload is the action id; the worker
-- treats the notification as a hint and always re-reads from the table.
create or replace function notify_bridge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.archived_at is null and (
       new.status = 'dispatched'
    or (new.status = 'proposed' and new.kind = 'decompose')
  ) then
    perform pg_notify('actions_dispatched', new.id::text);
  end if;
  return new;
end;
$$;

create trigger actions_notify_bridge
  after insert or update of status, kind on actions
  for each row execute function notify_bridge();

-- The decompose lane: proposed-and-decompose is the only non-dispatched state
-- the worker claims from, so give it the same cheap lookup the Queued lane has.
create index actions_decompose_proposed on actions (user_id, created_at)
  where archived_at is null and status = 'proposed' and kind = 'decompose';
