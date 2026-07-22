-- P1-F4: calibrate the fuzzy match.
--
-- 0006 left pg_trgm at its default word_similarity_threshold of 0.6, which
-- fails the acceptance criterion it was written for. Measured against real
-- phrasing:
--
--   'Decklan'   vs 'Ring Declan tomorrow about the retaining wall quote'  0.500
--   'Homeownie' vs 'Homeown.ie landing page copy needs a rewrite'         0.700
--   'Declan'    vs 'The decking needs replacing before winter'            0.429
--   'Declan'    vs 'Completely unrelated note about ordering concrete'    0.000
--
-- 0.45 is the only band that admits the dictation errors and still rejects
-- 'decking'. It is tight, and it is set from data rather than by feel — the
-- numbers are here so the next person adjusting it is arguing with evidence.
--
-- Set on the function rather than globally: this is retrieval's threshold, not
-- the database's, and a later consumer with different tolerances should get
-- its own rather than move this one.
--
-- The honest limit, and the P1-F4.2 observation to watch for: trigrams are
-- orthographic. 'Shivaun' scores 0.125 against 'Siobhan' — a phonetic garble
-- shares almost no trigrams and no lexeme, so neither half of this finds it.
-- That class of miss is the one that earns pgvector. Record them when they
-- happen; do not pre-empt them.

-- Force pg_trgm's library to load before the function is defined.
--
-- Until it does, `pg_trgm.word_similarity_threshold` is an unrecognised custom
-- GUC — a placeholder — and setting a placeholder needs superuser, which the
-- `postgres` role on Supabase is not. Loading the library first registers the
-- parameter as USERSET and the SET clause below is then accepted. Without this
-- line the migration fails with "permission denied to set parameter".
select extensions.word_similarity('warm', 'up');

create or replace function retrieve_captures(
  p_user_id uuid,
  p_query   text default null,
  p_limit   int  default 20
) returns setof captures
  language sql
  stable
  set search_path = public, extensions
  set pg_trgm.word_similarity_threshold = 0.45
as $$
  select c.*
    from captures c
   where c.user_id = p_user_id
     and (
       nullif(btrim(coalesce(p_query, '')), '') is null
       or c.search_tsv @@ websearch_to_tsquery('english', p_query)
       or p_query <% c.raw_text
     )
   order by
     greatest(
       ts_rank(
         c.search_tsv,
         websearch_to_tsquery('english', coalesce(nullif(btrim(p_query), ''), ''))
       ),
       word_similarity(coalesce(p_query, ''), c.raw_text)
     ) desc,
     c.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;
