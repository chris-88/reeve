-- AQ-7: the Work board.
--
-- Once an action is dispatched (Go, AQ-4) it leaves "Needs you" and moves
-- through the board's lanes: Queued -> Working -> Done. This adds the one new
-- state and the three columns that view needs — an order for the Queued lane
-- (the priority you set), who is working a card, and when they started.
--
-- The `queue_position` is the `position` the pivot deliberately removed from
-- actions, brought back HERE ONLY: it orders your assistants' backlog, which is
-- direction, not the self-logistics AQ-3 forbids in the decision stream.

-- Adding an enum value only; it is not used in this transaction, so it is safe
-- inside the migration runner's BEGIN/COMMIT on Postgres 17.
alter type action_status add value if not exists 'working';

alter table actions add column queue_position double precision;
-- The assistant working a card. A plain label until spec.md §9's real agents
-- populate it; a foreign key to an `assistants` table is a later, earned change.
alter table actions add column assignee text;
alter table actions add column started_at timestamptz;

-- The Queued lane: dispatched actions, in the order you dragged them into.
create index actions_queue on actions (user_id, queue_position)
  where archived_at is null and status = 'dispatched';
