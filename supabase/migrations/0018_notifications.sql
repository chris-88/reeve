-- PN-3 and PN-7.2 (docs/arc-spec-notifications.md): the morning due line, and
-- a word when the bridge has not picked something up.
--
-- Both are pg_cron jobs calling functions over pg_net, the idiom 0011 set for
-- the brief. URLs and the service key come from Vault because this file is
-- public; the two new secrets are `notify_due_function_url` and
-- `send_push_function_url`, created by hand like the others (CLAUDE.md).

-- ---------------------------------------------------------------------------
-- PN-3.2: 07:30 Europe/Dublin, DST-safe.
--
-- pg_cron runs on UTC. Rather than one schedule that drifts an hour across the
-- clock change (the brief's accepted compromise), the job fires at 06:30 and
-- 07:30 UTC and the function does nothing unless the Dublin hour is seven.
-- One of the two always is; the other returns 0 in a millisecond.
-- ---------------------------------------------------------------------------
create function run_due_reminders(force boolean default false) returns int
  language plpgsql
  security definer
  set search_path = public, vault
as $$
declare
  fn_url      text;
  service_key text;
  dispatched  int := 0;
  target      uuid;
  day_end     timestamptz;
begin
  if not force and extract(hour from now() at time zone 'Europe/Dublin') <> 7 then
    return 0;
  end if;

  select decrypted_secret into fn_url
    from vault.decrypted_secrets where name = 'notify_due_function_url';
  select decrypted_secret into service_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if fn_url is null or service_key is null then
    raise warning 'run_due_reminders: vault secrets missing, nothing dispatched';
    return 0;
  end if;

  -- The end of today in Dublin, as an instant. Only users with something open
  -- and dated no later than that get a call; the function decides the rest.
  day_end := ((now() at time zone 'Europe/Dublin')::date + 1) at time zone 'Europe/Dublin';

  for target in
    select distinct user_id
      from commitments
     where status = 'open'
       and due_at is not null
       and due_at < day_end
  loop
    perform net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || service_key
                 ),
      body    := jsonb_build_object('user_id', target),
      timeout_milliseconds := 30000
    );
    dispatched := dispatched + 1;
  end loop;

  return dispatched;
end;
$$;

revoke execute on function run_due_reminders(boolean) from public, anon, authenticated;

select cron.schedule('reeve-due-reminders', '30 6,7 * * *', 'select run_due_reminders()');

-- ---------------------------------------------------------------------------
-- PN-7.2: an action dispatched more than 30 minutes ago that nothing has
-- claimed means the bridge is down. Say so once per dispatch, on the phone.
--
-- `stuck_alerted_at` is compared with `dispatched_at`, and a Redo re-stamps
-- dispatched_at (lib/actions.ts), so a second stall after a Redo is reported
-- again. Rides on the existing five-minute `reeve-stuck-alert` job rather than
-- adding another.
-- ---------------------------------------------------------------------------
alter table actions add column stuck_alerted_at timestamptz;

create function report_stuck_actions() returns int
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
    select id, user_id, title
      from actions
     where status = 'dispatched'
       and archived_at is null
       and dispatched_at < now() - interval '30 minutes'
       and (stuck_alerted_at is null or stuck_alerted_at < dispatched_at)
     order by dispatched_at
     limit 20
  loop
    perform net.http_post(
      url     := push_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || service_key
                 ),
      -- The action's title is Chris's own words (WP-F3.4), as on every bridge push.
      body    := jsonb_build_object(
                   'user_id', r.user_id,
                   'notification', jsonb_build_object(
                     'title', 'Reeve hasn''t picked this up',
                     'body',  r.title,
                     'url',   '/#/work',
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

revoke execute on function report_stuck_actions() from public, anon, authenticated;

-- cron.schedule on an existing job name replaces its schedule and command (pg_cron ≥ 1.4).
select cron.schedule('reeve-stuck-alert', '*/5 * * * *', 'select report_stuck_captures(), report_stuck_actions()');
