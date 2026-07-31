---
name: reeve-migrate
description: Safely create and apply a Reeve database migration. Gates the traps that have cost data and hours.
disable-model-invocation: true
---

# reeve-migrate

A gated procedure for Reeve migrations. Every step here is a lesson paid for in
`CLAUDE.md`'s "Things that cost hours" — one of them destroyed unrecoverable
data. Do not skip a gate.

Docker is not available on this machine, so `supabase db push` / `db dump` will
fail. `scripts/migrate.mjs` connects directly over `DATABASE_URL` and tracks
applied migrations in `_reeve_migrations` with SHA checksums. Use it.

## Procedure

1. **`pnpm db:status` first — before you even name the file.** Tracking is by
   filename, so a duplicate number applies silently, and if it sorts before an
   existing one it runs out of order. Name the new migration with the next free
   number the status shows, never a number a spec guessed.
2. **If the migration will infer anything from existing data, look at the data
   first.** The `corrected_area_id` loss came from a migration that derived an
   owner from "the account with the most captures" while a test suite had more
   fixtures than the real account. Run the actual count, e.g.
   `select u.email, count(*) from auth.users u join captures c on c.user_id = u.id group by 1;`
3. **Write the migration.**
   - If it **defines a function**, remember plpgsql does not parse the body at
     creation time — a bad `min(id)` over a uuid created cleanly and failed on
     the first cron run. You will verify by **calling it** in step 6.
   - If it touches **`pg_trgm`** thresholds, put a `select word_similarity('a','b');`
     ahead of the `create function` so the extension's library loads — otherwise
     the GUC is unrecognised and setting it needs superuser (the error says
     "permission denied to set parameter," which sends you the wrong way).
4. **Dry run:** `pnpm db:migrate --dry-run`. Reports without applying.
5. **Apply:** `pnpm db:migrate`. A migration that **rewrites existing rows** is
   refused unless you pass `--yes`; only add it once the reported UPDATE/DELETE
   counts are exactly what you expect. This gate exists because one row-rewriting
   migration ran clean, reported success, and destroyed data.
6. **Call any function the migration defined** to prove it parses and runs.
   Applying the migration did not verify it (step 3).
7. **Never edit an applied migration** — `migrate.mjs` compares SHA checksums and
   refuses. If it is wrong, add a new migration; do not rewrite the old one.

## Done when

The migration is applied, any function it defines has been called successfully,
and `pnpm db:status` shows it tracked.
