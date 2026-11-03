-- 0019_second_edition.sql
-- Second edition (docs/spec.md §4): the GitHub change-request loop is retired, two small
-- columns arrive for the bridge, and the app reads domains through a view.
--
-- The five change_requests rows were exported to the vault before this ran
-- (x/sources/reeve/change-requests-2026-11.json). Everything dropped here is history.

-- E-1: the change-request loop ------------------------------------------------------------
select cron.unschedule('reeve-file-sweep');

drop view if exists reeve_capture_share;
drop view if exists change_request_leadtime;

alter publication supabase_realtime drop table change_requests;

drop table if exists change_request_captures cascade;
drop table if exists change_requests cascade;

drop function if exists enforce_one_change_request_per_capture();
drop function if exists sweep_change_requests();

drop type if exists change_request_status;

delete from vault.secrets where name = 'file_change_request_url';

-- E-2: small additions ---------------------------------------------------------------------
alter table actions add column if not exists result_files text[];

alter table captures
  add column if not exists filed_path text,
  add column if not exists file_requested boolean not null default false;

-- The bridge polls for notes to file; keep that scan cheap.
create index if not exists captures_file_requested
  on captures (created_at)
  where file_requested and filed_path is null;

-- The product says "domain"; the table keeps its name. RLS on areas applies through
-- security_invoker.
create or replace view domains with (security_invoker = true) as
  select id, label, classifier_hint as hint, colour, sort_order, owner_id as user_id
    from areas
   where active;

grant select on domains to authenticated, service_role;
