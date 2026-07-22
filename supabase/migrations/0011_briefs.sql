-- P1-F6.1: the daily brief.
--
-- The first agent that runs unattended, and chosen deliberately for what it
-- cannot do: no tools, no credentials, no contact with the outside world, and
-- nowhere to write except this table. It exercises the whole substrate —
-- retrieval, model tiering, cost logging, scheduling, delivery — while the
-- worst available failure is a badly written paragraph.

create table briefs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  period_end   timestamptz not null,
  body         text not null,
  model        text not null,
  created_at   timestamptz not null default now()
);

create index briefs_by_user_time on briefs (user_id, created_at desc);

-- One brief per user per window. The scheduler is at-least-once — a retry
-- after a lost response must not produce a second brief, and must not spend a
-- second Sonnet call to find that out.
create unique index briefs_period on briefs (user_id, period_start);

-- ---------------------------------------------------------------------------
-- Owner-scoped, and never deleted. A brief is a record of what the system
-- thought was outstanding on a given morning; that is worth keeping for the
-- same reason corrected_area_id is.
-- ---------------------------------------------------------------------------
alter table briefs enable row level security;

create policy briefs_select on briefs
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- P1-F6.2: scheduled, early morning local time.
--
-- 06:10 Europe/Dublin. pg_cron runs on UTC, so this is expressed as 05:10 UTC
-- and drifts by an hour across the clock change — deliberately left alone
-- rather than solved with two schedules, because "the brief arrives between
-- six and seven" is a promise the system can keep either way.
--
-- Ten past rather than on the hour: the sweeper and the reaper both fire on
-- the minute, and there is no reason to queue behind them.
-- ---------------------------------------------------------------------------
create function run_daily_brief() returns int
  language plpgsql
  security definer
  set search_path = public, vault
as $$
declare
  fn_url      text;
  service_key text;
  dispatched  int := 0;
  target      uuid;
begin
  select decrypted_secret into fn_url
    from vault.decrypted_secrets where name = 'brief_function_url';
  select decrypted_secret into service_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if fn_url is null or service_key is null then
    raise warning 'run_daily_brief: vault secrets missing, nothing dispatched';
    return 0;
  end if;

  -- Only accounts that actually use the system. A test account with three
  -- fixtures does not need a Sonnet call every morning, and P1-F13 exists
  -- because fixtures have already been mistaken for real data once.
  for target in
    select c.user_id
      from captures c
     group by c.user_id
    having count(*) filter (where c.created_at > now() - interval '30 days') > 0
  loop
    perform net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || service_key
                 ),
      body    := jsonb_build_object('user_id', target),
      timeout_milliseconds := 60000
    );
    dispatched := dispatched + 1;
  end loop;

  return dispatched;
end;
$$;

revoke execute on function run_daily_brief() from public, anon, authenticated;

select cron.schedule('reeve-daily-brief', '10 5 * * *', 'select run_daily_brief()');
