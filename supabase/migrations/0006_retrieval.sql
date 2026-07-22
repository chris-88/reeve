-- P1-F4: cross-capture retrieval.
--
-- Triage classifies each note in perfect isolation: one call, one note, no
-- knowledge that four hundred others exist. That is right for classification
-- and useless for everything after it. Every interesting Phase 1 operation
-- spans captures — what is outstanding on this build, did I ever follow up
-- with him, are these six notes the same job — and all of them need a
-- retrieval step before the model call.
--
-- P1-F4.1: Postgres full-text search, not embeddings. At this corpus size it
-- is very likely sufficient, costs nothing per query, and introduces no second
-- vendor — Anthropic does not provide an embeddings API, so pgvector would add
-- one. P1-F4.2 names the observation that earns the upgrade: a retrieval that
-- should have found a capture and did not, because the wording differed.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- The index.
--
-- Generated rather than maintained by trigger: triage writes title and summary
-- minutes after raw_text lands, and a trigger that someone forgets to fire on
-- one of those paths produces a capture that is simply unfindable.
-- ---------------------------------------------------------------------------
alter table captures add column search_tsv tsvector
  generated always as (
    to_tsvector(
      'english',
      coalesce(raw_text, '') || ' ' || coalesce(title, '') || ' ' || coalesce(summary, '')
    )
  ) stored;

create index captures_search on captures using gin (search_tsv);

-- Trigram over the raw text, for the case stemming cannot help with: a name
-- the dictation garbled. "Declan" and "Decklan" share no lexeme and most of
-- their trigrams.
create index captures_raw_trgm on captures using gin (raw_text extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- P1-F4.3: one function, one signature, every consumer.
--
-- Two call sites building context two different ways is how agent quality
-- becomes unexplainable — you cannot tell a bad answer from a bad retrieval.
--
-- P1-F4.4: user_id is a parameter and a predicate, not an assumption. RLS
-- covers the browser, but the Edge Function holds the secret key and bypasses
-- it entirely, so the scoping has to be in the query. Same discipline the
-- triage function already applies.
--
-- word_similarity(query, target) rather than similarity(): similarity compares
-- whole strings, so a person's name against a two-paragraph capture scores
-- near zero. word_similarity scores the query against the best-matching extent
-- within the target, which is the question actually being asked. The `<%`
-- operator is its indexable form.
-- ---------------------------------------------------------------------------
create function retrieve_captures(
  p_user_id uuid,
  p_query   text default null,
  p_limit   int  default 20
) returns setof captures
  language sql
  stable
  set search_path = public, extensions
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

-- Deliberately security invoker, which is the default: a browser calling this
-- still has RLS applied on top of the explicit predicate. Defence in depth is
-- the point — the predicate is what makes it correct from the Edge Function,
-- and RLS is what makes a mistake in the predicate survivable from the client.
