---
name: implement
description: Build the work in a Reeve spec or tickets — TDD at seams, Reeve's git rules, close with review and ship.
disable-model-invocation: true
---

# implement (Reeve)

Forked from the borrowed `implement` to obey Reeve's rules. This is an
**implementation session**: Chris does not want to write code — self-serve. Use
the credentials in `.env.local`, the migration runner, the seeder and the deploy
pipeline rather than handing back instructions (`spec-owner-not-implementer`).

## Procedure

1. **Work from the spec / tickets.** Build in vertical slices; ship each to a
   working state before the next.
2. **TDD at pre-agreed seams.** Use `/tdd`; confirm the seams up front. Reeve's
   tests are coupled to a live backend by design — resolve test accounts by
   signing in (`signInTestUser`), and give any triaging suite its own areas
   (never the owner's real taxonomy).
3. **Database work goes through `reeve-migrate`** — the numbering, data, and
   function-verification gates are not optional.
4. **Git:** if on `main`, **branch first**. **Commit only when asked**, and only
   what is yours. This overrides any borrowed habit of committing automatically.
5. **Run checks regularly** — `pnpm typecheck`, single test files as you go, the
   full `pnpm test` once at the end.
6. **Close out with review, then ship.** Use the built-in **`/code-review`** (or
   `/code-review ultra`) — not a borrowed reviewer — then follow **`reeve-ship`**:
   push once, watch CI, confirm the deploy, update the spec's
   `## 0. Implementation status` and `CLAUDE.md`.

## Done when

Green CI, a confirmed deploy, the spec's status section updated with anything the
spec did not predict, and `CLAUDE.md` updated if a lesson was learned.
