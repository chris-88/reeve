# Reeve

A personal capture system. You type or dictate a thought; it gets classified to
an area of your life, summarised, and filed — in under fifteen seconds.

Supabase is the system of record. There is no vault, no local runner, and
nothing that needs your machine to be awake.

## Stack

| | |
|---|---|
| Client | Vite, React, TypeScript, shadcn/ui, Tailwind |
| Backend | Supabase — Postgres, Auth, Realtime, Edge Functions |
| Model | Claude Haiku 4.5 via the Messages API, with structured outputs |
| Hosting | GitHub Pages |

## Layout

```
apps/web              PWA. Installable to a phone home screen.
packages/shared       Zod schemas, the triage prompt, model tier map
supabase/migrations   SQL migrations, applied with `pnpm db:migrate`
supabase/functions    Edge Functions
scripts               Migration runner, seeder, bundle secret check
```

## Setup

```sh
cp .env.example .env.local          # fill in — see comments in the file
cp supabase/seed/areas.example.json supabase/seed/areas.json
pnpm install
pnpm db:migrate                     # schema
pnpm db:seed                        # your life areas
pnpm dev
```

Edit `supabase/seed/areas.json` to describe your own areas. Each
`classifier_hint` is fed verbatim to the model and is the single biggest lever
on classification quality — if triage files things wrong, start there.

`areas.json` is gitignored because those descriptions are personal.

## Deploying the Edge Function

```sh
export SUPABASE_ACCESS_TOKEN=...
supabase secrets set ANTHROPIC_API_KEY=... --project-ref <ref>
supabase functions deploy triage --project-ref <ref>
```

## Notes

- **Captures are never dropped.** A capture the model can't confidently place is
  routed to `unsorted` rather than failed. A misfiled thought is recoverable; a
  lost one is only discovered when you need it.
- **Re-filing is a signal, not a correction.** Changing a capture's area writes
  `corrected_area_id` and leaves the model's original choice intact. The gap
  between the two is the only honest evidence about whether the taxonomy works.
- **Saving is local-first.** Captures go to IndexedDB and sync in the
  background, because the network on a building site is not a given.
- `pnpm build` fails if any secret reaches the bundle — see
  `scripts/check-bundle.mjs`.
