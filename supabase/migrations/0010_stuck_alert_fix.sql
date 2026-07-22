-- Fix report_stuck_captures: there is no min(uuid) in Postgres.
--
-- plpgsql does not parse the SQL inside a function body at creation time, so
-- `min(id)` over a uuid column defined cleanly and failed on the first call.
-- `--dry-run` would not have caught it either — the statement that fails is
-- never executed by the migration itself, only by the cron job afterwards.
--
-- The lesson worth keeping: a migration that defines a function is not
-- verified by applying it. Call the function.

create or replace function report_stuck_captures() returns int
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
  select count(*)::int, extract(epoch from (now() - min(updated_at)))::int
    into stuck_count, oldest_age
    from captures
   where status in ('queued', 'processing')
     and updated_at < now() - interval '15 minutes';

  if stuck_count = 0 then
    return 0;
  end if;

  -- Ordered rather than aggregated: the oldest row's id, not the smallest id.
  select id into oldest_id
    from captures
   where status in ('queued', 'processing')
     and updated_at < now() - interval '15 minutes'
   order by updated_at
   limit 1;

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
                 -- F7.4: a count and an id. Never the capture's words.
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
