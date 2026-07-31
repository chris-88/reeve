---
name: to-tickets
description: Break a Reeve spec or plan into tracer-bullet, vertical-slice tickets in a local file. No external tracker.
disable-model-invocation: true
---

# to-tickets (Reeve)

Forked from the borrowed `to-tickets`: Reeve has no dev issue tracker. Write the
tickets to a **local Markdown file** (alongside the spec, e.g.
`docs/arc-spec-<slug>.md` itself carries them, or a sibling `-tickets.md`), each
declaring the tickets that **block** it in text.

## Rules

- Each ticket is a **tracer bullet**: a narrow but **complete** vertical slice
  through every layer it touches (migration → shared types → function → UI →
  tests), never a horizontal slice of one layer.
- **Declare blocking edges** as text ("blocked by: T2"). No native tracker links
  — there is no tracker.
- Use Reeve's real machinery in the ticket bodies: migrations via
  `reeve-migrate` / `scripts/migrate.mjs` (respect the numbering and data gates),
  shared types in `packages/shared`, Edge Functions under `supabase/functions`,
  tests in `pnpm test` / `pnpm test:e2e`.
- Look for **prefactors** — "make the change easy, then make the easy change."
- Ticket titles and bodies use Reeve's own vocabulary (captures, areas,
  commitments, actions, change requests, briefs).

## Done when

The work is a set of ordered vertical slices in a local file, each with its
blocking edges and an acceptance line, ready for an implementation session.
