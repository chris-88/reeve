-- WP-F2: where a push subscription lives.
--
-- The spec numbers this document's sibling table `0008_change_requests.sql`.
-- Web Push landed first, so change requests become 0009. Numbering a migration
-- inside a spec is fragile for exactly this reason — two approved documents
-- cannot both own the next integer. Check `pnpm db:status` before naming one.

create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- WP-F2.2: unique, so a device that reinstalls twice leaves one row rather
  -- than three endpoints the sender will fail against forever.
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  last_error   text
);

create index push_subscriptions_by_user on push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- WP-F2.1: owner-scoped, and delete is permitted here.
--
-- Captures and commitments have no delete policy on purpose — a thought and a
-- promise are records, and losing one is the failure this system exists to
-- prevent. A subscription is neither. It is disposable infrastructure that the
-- platform itself revokes and reissues, and "unsubscribe" has to actually
-- remove the row or the next send resurrects the notification.
-- ---------------------------------------------------------------------------
alter table push_subscriptions enable row level security;

create policy push_subscriptions_select on push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_insert on push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_subscriptions_update on push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete on push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));
