-- P1-F5 (cost ceiling) and hardening F7.6 (the stuck-capture alert).
--
-- Together, because they are the same idea twice: something is instrumented,
-- nothing reads it, and the condition it would reveal is one you would
-- otherwise discover weeks later. `agent_runs.cost_usd` has been written since
-- Phase 0 and read by nothing; a capture stuck at 'queued' is invisible until
-- you go looking for the thought.
--
-- P1-F5.2 is specified to alert, so it needs somewhere to alert to. That is
-- why F7 is not a separate piece of work from the ceiling.

-- ---------------------------------------------------------------------------
-- P1-F5.1: what has this cost.
--
-- security_invoker so the policies on agent_runs still apply. cost_usd is null
-- for an unpriced model — deliberately, per P1-F5.3 — so `unpriced` counts
-- what the totals cannot see. A rising unpriced count means PRICING in
-- packages/shared/src/models.ts has fallen behind the models in use, and every
-- number beside it is understated.
-- ---------------------------------------------------------------------------
create view agent_spend_daily with (security_invoker = true) as
select
  user_id,
  (created_at at time zone 'Europe/Dublin')::date as day,
  count(*)::int                                   as runs,
  count(*) filter (where not ok)::int             as failures,
  count(*) filter (where cost_usd is null)::int   as unpriced,
  coalesce(sum(cost_usd), 0)::numeric(12, 6)      as cost_usd
from agent_runs
group by user_id, (created_at at time zone 'Europe/Dublin')::date;

create view agent_spend_monthly with (security_invoker = true) as
select
  user_id,
  date_trunc('month', created_at at time zone 'Europe/Dublin')::date as month,
  count(*)::int                                   as runs,
  count(*) filter (where not ok)::int             as failures,
  count(*) filter (where cost_usd is null)::int   as unpriced,
  coalesce(sum(cost_usd), 0)::numeric(12, 6)      as cost_usd
from agent_runs
group by user_id, date_trunc('month', created_at at time zone 'Europe/Dublin')::date;

-- ---------------------------------------------------------------------------
-- P1-F5.2: the ceiling, answerable in one round trip.
--
-- A scheduled function must be able to ask "may I spend?" before it spends,
-- cheaply and without assembling the arithmetic itself. Two callers computing
-- a rolling window two different ways is how one of them ends up not enforcing
-- anything.
--
-- Rolling windows rather than calendar periods: a calendar month resets the
-- budget at midnight on the 1st, which is exactly when a runaway loop would
-- get a second night to run.
-- ---------------------------------------------------------------------------
create function agent_spend_since(p_user_id uuid, p_window interval)
  returns numeric
  language sql
  stable
  set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)::numeric
    from agent_runs
   where user_id = p_user_id
     and created_at >= now() - p_window;
$$;

-- ---------------------------------------------------------------------------
-- F7.6: a capture stuck in queued or processing for more than 15 minutes.
--
-- The one condition the user would otherwise discover weeks later, when they
-- went looking for the thought. The pg_cron sweeper already returns abandoned
-- rows to the queue every minute; what has been missing is anything that says
-- so when the queue stops draining.
--
-- Posted straight to Sentry's store endpoint with pg_net rather than through
-- an Edge Function: the sweeper is already here, the event is four fields, and
-- a function whose own failure is the thing being watched for is a poor place
-- to put the watching. The DSN is read from Vault for the same reason the
-- service key is — this migration is committed to a public repository.
--
-- F7.4 applies here too: a count and an id, never a capture's words.
-- ---------------------------------------------------------------------------
create function report_stuck_captures() returns int
  language plpgsql
  security definer
  set search_path = public, vault, extensions
as $$
declare
  dsn         text;
  sentry_key  text;
  sentry_host text;
  project_id  text;
  stuck_count int;
  oldest_id   uuid;
  oldest_age  int;
begin
  select count(*)::int, min(id), extract(epoch from (now() - min(updated_at)))::int
    into stuck_count, oldest_id, oldest_age
    from captures
   where status in ('queued', 'processing')
     and updated_at < now() - interval '15 minutes';

  if stuck_count = 0 then
    return 0;
  end if;

  select decrypted_secret into dsn
    from vault.decrypted_secrets where name = 'sentry_dsn';

  if dsn is null then
    raise warning 'report_stuck_captures: % capture(s) stuck, and no sentry_dsn in vault', stuck_count;
    return stuck_count;
  end if;

  -- https://<key>@<host>/<project_id>
  sentry_key  := (regexp_match(dsn, '^https://([0-9a-f]+)@'))[1];
  sentry_host := (regexp_match(dsn, '^https://[0-9a-f]+@([^/]+)/'))[1];
  project_id  := (regexp_match(dsn, '/(\d+)$'))[1];

  if sentry_key is null or sentry_host is null or project_id is null then
    raise warning 'report_stuck_captures: sentry_dsn is malformed';
    return stuck_count;
  end if;

  perform net.http_post(
    url     := format('https://%s/api/%s/store/', sentry_host, project_id),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'X-Sentry-Auth',
                 format('Sentry sentry_version=7, sentry_key=%s, sentry_client=reeve-pg/1.0', sentry_key)
               ),
    body    := jsonb_build_object(
                 'event_id',  replace(gen_random_uuid()::text, '-', ''),
                 'timestamp', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                 'platform',  'other',
                 'logger',    'postgres',
                 'level',     'error',
                 'message',   jsonb_build_object(
                                'formatted',
                                format('%s capture(s) stuck for over 15 minutes', stuck_count)
                              ),
                 'tags',      jsonb_build_object('step', 'stuck_captures'),
                 'extra',     jsonb_build_object(
                                'count', stuck_count,
                                'oldest_capture_id', oldest_id,
                                'oldest_age_seconds', oldest_age
                              )
               ),
    timeout_milliseconds := 10000
  );

  return stuck_count;
end;
$$;

revoke execute on function report_stuck_captures() from public, anon, authenticated;
revoke execute on function agent_spend_since(uuid, interval) from public, anon;

-- Every five minutes. A capture is only called stuck after fifteen, so this
-- alerts within twenty at worst and does not re-fire on every sweeper tick.
select cron.schedule('reeve-stuck-alert', '*/5 * * * *', 'select report_stuck_captures()');
