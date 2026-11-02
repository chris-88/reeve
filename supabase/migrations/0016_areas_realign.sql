-- BR-0: areas realign to the vault's domains (docs/arc-spec-bridge.md).
--
-- Areas are per-owner rows seeded from the gitignored supabase/seed/areas.json,
-- so the realignment itself is a seed change: the twelve domain ids become the
-- live set and the old ids are retired with active = false (kept, because
-- actions, captures and commitments reference areas by composite foreign key).
--
-- This migration is the data half: anything still filed under a retired id is
-- moved to its successor, where that successor exists for the same owner. Run
-- the seed first (`pnpm db:seed --owner …`), then this. On the owner's live
-- database nothing referenced the retired ids except `reeve` and `unsorted`,
-- which are unchanged, so the expected rewrite count is zero; the runner's
-- `--yes` gate reports otherwise.
--
-- Test accounts keep their own invented taxonomies and are untouched: the
-- mapping only applies where the owner actually has the successor area.

create temp table area_remap (old_id text, new_id text) on commit drop;
insert into area_remap values
  ('homeownie',   'homeown'),
  ('club',        'phibsboro'),
  ('dayjob',      'boi'),
  ('personal',    'family'),
  ('contracting', 'money'),
  ('charity',     'unsorted');

update actions a
   set area_id = m.new_id
  from area_remap m
 where a.area_id = m.old_id
   and exists (select 1 from areas x where x.owner_id = a.user_id and x.id = m.new_id);

update commitments c
   set area_id = m.new_id
  from area_remap m
 where c.area_id = m.old_id
   and exists (select 1 from areas x where x.owner_id = c.user_id and x.id = m.new_id);

update captures c
   set area_id = m.new_id
  from area_remap m
 where c.area_id = m.old_id
   and exists (select 1 from areas x where x.owner_id = c.user_id and x.id = m.new_id);

-- A correction is a signal (CLAUDE.md invariants): it is remapped, never cleared.
update captures c
   set corrected_area_id = m.new_id
  from area_remap m
 where c.corrected_area_id = m.old_id
   and exists (select 1 from areas x where x.owner_id = c.user_id and x.id = m.new_id);
