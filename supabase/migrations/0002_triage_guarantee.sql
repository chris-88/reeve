-- Triage completion guarantee.
--
-- Before this, the Edge Function's MAX_ATTEMPTS was dead code: the only caller
-- was the browser, firing once immediately after insert. A capture whose invoke
-- never landed — connectivity dropped in the window between insert and call,
-- tab closed, bad deploy — sat at 'queued' forever showing "Filing…".
--
-- Two cron jobs close that: one returns abandoned 'processing' rows to the
-- queue, the other invokes triage for anything still waiting.

-- ---------------------------------------------------------------------------
-- F5.4: index supporting both jobs' scans.
-- ---------------------------------------------------------------------------
create index captures_pending on captures (status, updated_at)
  where status in ('queued', 'processing');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- F5.2: reaper.
--
-- A function that crashes after taking the lock leaves the row in 'processing'
-- with nothing to release it. Anything sitting there beyond the threshold is
-- assumed abandoned and returned to the queue. attempts is not incremented —
-- the run never completed, so it was not a real attempt.
-- ---------------------------------------------------------------------------
create function reap_abandoned_captures() returns int
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  reaped int;
begin
  update captures
     set status = 'queued'
   where status = 'processing'
     and updated_at < now() - interval '5 minutes';
  get diagnostics reaped = row_count;
  return reaped;
end;
$$;

-- ---------------------------------------------------------------------------
-- F5.3: sweeper.
--
-- Invokes the triage function for rows still queued, oldest first, respecting
-- the same attempt ceiling the function enforces. Backoff widens with each
-- attempt so a failing model does not get hammered.
--
-- The service key is read from Vault rather than written here: this migration
-- is committed to a public repository.
-- ---------------------------------------------------------------------------
create function sweep_queued_captures() returns int
  language plpgsql
  security definer
  set search_path = public, vault
as $$
declare
  fn_url text;
  service_key text;
  swept int := 0;
  row_id uuid;
begin
  select decrypted_secret into fn_url
    from vault.decrypted_secrets where name = 'triage_function_url';
  select decrypted_secret into service_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if fn_url is null or service_key is null then
    raise warning 'sweep_queued_captures: vault secrets missing, nothing swept';
    return 0;
  end if;

  for row_id in
    select id from captures
     where status = 'queued'
       and attempts < 3
       -- 1st retry after 1m, 2nd after 4m, 3rd after 9m.
       and updated_at < now() - (interval '1 minute' * greatest(power(attempts, 2), 1))
     order by created_at
     limit 20
  loop
    perform net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || service_key
                 ),
      body    := jsonb_build_object('capture_id', row_id),
      timeout_milliseconds := 30000
    );
    swept := swept + 1;
  end loop;

  return swept;
end;
$$;

-- Neither function should be callable from the client; they run as the
-- scheduler and bypass RLS by design.
revoke execute on function reap_abandoned_captures() from public, anon, authenticated;
revoke execute on function sweep_queued_captures() from public, anon, authenticated;

select cron.schedule('reeve-reap',  '* * * * *', 'select reap_abandoned_captures()');
select cron.schedule('reeve-sweep', '* * * * *', 'select sweep_queued_captures()');
