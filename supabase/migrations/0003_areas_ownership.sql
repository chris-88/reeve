-- P1-F0: areas ownership.
--
-- 0001 created `areas` with no owner and the policy:
--
--   create policy areas_read on areas for select to authenticated using (true);
--
-- Every authenticated account could therefore read every classifier_hint —
-- one or two sentences each describing the owner's business, football club,
-- charity and family admin. The seed file is gitignored on exactly those
-- grounds; the application then served the same text to anyone with a session.
--
-- Sign-ups are disabled on the project, so this was latent rather than live.
-- It stops being latent the moment a second account exists.
--
-- The spec asks for this in migration 0002. That file is applied and carries a
-- SHA checksum, so editing it makes scripts/migrate.mjs refuse; the numbering
-- shifts by one for this and every migration below it.

-- ---------------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------------
alter table areas add column owner_id uuid references auth.users(id) on delete cascade;

-- Backfill. The identity cannot be written here — this migration is committed
-- to a public repository — so it is derived: the account with the most captures
-- is the account whose areas these are. The tie-break keeps the result stable
-- if this ever runs against a copy.
update areas
   set owner_id = (
     select user_id from captures group by user_id order by count(*) desc, user_id limit 1
   )
 where owner_id is null;

-- A row with no owner would be invisible under the policy below and would
-- break the foreign key that follows. Fail loudly rather than half-applying.
do $$
begin
  if exists (select 1 from areas where owner_id is null) then
    raise exception
      'areas rows have no owner and none could be derived. Seed with `pnpm db:seed --owner <email>` first.';
  end if;
end $$;

alter table areas alter column owner_id set not null;

-- ---------------------------------------------------------------------------
-- Per-user identity
--
-- P1-F0.3 chooses duplicating `unsorted` per user over a special case in the
-- policy. `id` was the primary key, so two rows could not share the slug — the
-- key has to become composite for that choice to be available at all.
--
-- The captures foreign keys become composite with it, which is the part worth
-- having: filing a capture into another account's area is now impossible in
-- the schema rather than merely unlikely in the code.
-- ---------------------------------------------------------------------------
alter table captures drop constraint captures_area_id_fkey;
alter table captures drop constraint captures_corrected_area_id_fkey;

-- Captures filed into an area that turns out to belong to somebody else.
--
-- This is the old policy's consequence made concrete: the RLS test accounts
-- have captures the triage function filed into the owner's taxonomy, because
-- it read every area regardless of who asked. Those rows were never validly
-- filed, so they are returned to unfiled rather than carried across — pointing
-- them at an area they cannot see would be worse, and inventing areas for an
-- account that has none would be worse still. The capture text itself is
-- untouched: nothing is lost, only a label that was never true.
update captures c
   set area_id = null
 where c.area_id is not null
   and not exists (
     select 1 from areas a where a.id = c.area_id and a.owner_id = c.user_id
   );

update captures c
   set corrected_area_id = null, corrected_at = null
 where c.corrected_area_id is not null
   and not exists (
     select 1 from areas a where a.id = c.corrected_area_id and a.owner_id = c.user_id
   );

alter table areas drop constraint areas_pkey;
alter table areas add primary key (owner_id, id);

-- MATCH SIMPLE, the default: a null area_id satisfies the constraint, which is
-- what a capture still queued for triage looks like.
alter table captures add constraint captures_area_fkey
  foreign key (user_id, area_id) references areas (owner_id, id);
alter table captures add constraint captures_corrected_area_fkey
  foreign key (user_id, corrected_area_id) references areas (owner_id, id);

-- ---------------------------------------------------------------------------
-- Policy
--
-- Owner-scoped select, and still no write path from the client: areas are
-- config, applied by `pnpm db:seed` over a direct connection.
-- ---------------------------------------------------------------------------
drop policy areas_read on areas;

create policy areas_select on areas
  for select to authenticated using (owner_id = (select auth.uid()));
