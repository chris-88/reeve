-- P1-F7: change requests.
--
-- The `reeve` area already exists, so thoughts about the app are already being
-- captured and filed. They currently go nowhere: acting on one means being at
-- a desk, remembering the thought, and describing it again to a coding agent —
-- the exact friction Reeve was built to remove, for every subject except
-- itself. This stage closes that loop.
--
-- A change request is one or more captures, promoted deliberately, drafted
-- into something a developer or coding agent can act on. The many-to-one shape
-- matters: "the inbox feels cramped", "the date should be bigger" and "why is
-- the word count still there", captured across three days, are one ticket.

create type change_request_status as enum (
  'draft',        -- captures gathered, nothing drafted yet
  'proposed',     -- an agent has written a body; awaiting Chris
  'rejected',     -- declined. Never deleted, and never re-proposed
  'filed',        -- an issue exists on GitHub
  'in_progress',  -- a pull request is open
  'shipped',      -- merged and deployed
  'abandoned'     -- closed without merging
);

create table change_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  body         text,                          -- markdown, house spec style
  questions    text[] not null default '{}',  -- ambiguities the agent would not resolve
  status       change_request_status not null default 'draft',
  -- F9.5: the handoff to a coding agent is opt-in per request, chosen at
  -- approval time. Not in the spec's column list, but F9.5 needs somewhere to
  -- record the choice, and it must ride with the row the filing step reads.
  auto_handoff boolean not null default false,
  -- Outbound identity. Null until filed.
  issue_number int,
  issue_url    text,
  pr_number    int,
  pr_url       text,
  -- Idempotency for the filing step. An approval acted on twice must not
  -- create two issues. Same principle as §8's execution_key.
  filing_key   text unique not null default gen_random_uuid()::text,
  -- F7.5: approval is a state transition that syncs through the outbox. A
  -- 'proposed' row with decided_at set is approved and awaiting filing; a
  -- 'rejected' row with decided_at set was declined. The distinction the
  -- filing sweeper reads is exactly (status, decided_at, issue_number).
  decided_at   timestamptz,
  filed_at     timestamptz,
  shipped_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table change_request_captures (
  change_request_id uuid not null references change_requests(id) on delete cascade,
  capture_id        uuid not null references captures(id) on delete cascade,
  primary key (change_request_id, capture_id)
);

create index change_requests_open on change_requests (user_id, status, created_at desc);
create index change_request_captures_by_capture on change_request_captures (capture_id);

create trigger change_requests_set_updated_at
  before update on change_requests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- F7.4: a capture belongs to at most one non-rejected change request.
--
-- Cannot be a partial unique index, because "non-rejected" is a property of
-- the parent row, not of the join row. A trigger is the honest enforcement:
-- so the same thought cannot be filed twice through two clusters.
--
-- A capture that was in a rejected request may join a new one — F7.3 keeps the
-- rejected record but does not sentence the capture. The automated clustering
-- pass excludes it anyway (it excludes anything already considered); this rule
-- only governs deliberate promotion.
-- ---------------------------------------------------------------------------
create function enforce_one_change_request_per_capture() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if exists (
    select 1
      from change_request_captures crc
      join change_requests cr on cr.id = crc.change_request_id
     where crc.capture_id = new.capture_id
       and cr.id <> new.change_request_id
       and cr.status <> 'rejected'
  ) then
    raise exception 'capture % already belongs to a non-rejected change request', new.capture_id
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

create trigger change_request_captures_one_per_capture
  before insert on change_request_captures
  for each row execute function enforce_one_change_request_per_capture();

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- F7.1: owner-scoped, and no delete policy on either table. A rejected idea is
-- kept, for the same reason corrected_area_id is kept — the record of what was
-- declined is evidence. Inserts and updates come from the drafting and filing
-- functions under the secret key, which bypasses RLS; the client policies
-- exist for the review UI (F11, later) and the with-check is what makes them
-- safe.
-- ---------------------------------------------------------------------------
alter table change_requests enable row level security;
alter table change_request_captures enable row level security;

create policy change_requests_select on change_requests
  for select to authenticated using (user_id = (select auth.uid()));
create policy change_requests_insert on change_requests
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy change_requests_update on change_requests
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The join table is owner-scoped through its parent: you may read or link a
-- capture only within a change request you own and to a capture you own.
create policy change_request_captures_select on change_request_captures
  for select to authenticated using (
    exists (select 1 from change_requests cr
             where cr.id = change_request_id and cr.user_id = (select auth.uid()))
  );
create policy change_request_captures_insert on change_request_captures
  for insert to authenticated with check (
    exists (select 1 from change_requests cr
             where cr.id = change_request_id and cr.user_id = (select auth.uid()))
    and exists (select 1 from captures c
                 where c.id = capture_id and c.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Realtime: the review UI, when it exists, watches a draft become proposed and
-- a proposal become filed in place.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table change_requests;

-- ---------------------------------------------------------------------------
-- F7.5 / F9: filing happens server-side when the approval syncs.
--
-- A sweeper, matching the reap/sweep pattern already in 0002 rather than
-- inventing a trigger-calls-http mechanism. It invokes file-change-request for
-- each approved, unfiled request. Idempotency (F9.3) is what makes it safe to
-- run every minute and safe against an approval that syncs twice.
--
-- The function URL and service key come from Vault: this migration is public.
-- ---------------------------------------------------------------------------
create function sweep_change_requests() returns int
  language plpgsql
  security definer
  set search_path = public, vault
as $$
declare
  fn_url      text;
  service_key text;
  swept       int := 0;
  row_id      uuid;
begin
  select decrypted_secret into fn_url
    from vault.decrypted_secrets where name = 'file_change_request_url';
  select decrypted_secret into service_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if fn_url is null or service_key is null then
    raise warning 'sweep_change_requests: vault secrets missing, nothing swept';
    return 0;
  end if;

  for row_id in
    select id from change_requests
     where status = 'proposed'
       and decided_at is not null
       and issue_number is null
     order by decided_at
     limit 5
  loop
    perform net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || service_key
                 ),
      body    := jsonb_build_object('change_request_id', row_id),
      timeout_milliseconds := 30000
    );
    swept := swept + 1;
  end loop;

  return swept;
end;
$$;

revoke execute on function sweep_change_requests() from public, anon, authenticated;

select cron.schedule('reeve-file-sweep', '* * * * *', 'select sweep_change_requests()');
