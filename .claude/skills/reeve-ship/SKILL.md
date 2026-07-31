---
name: reeve-ship
description: Reeve's close-out and ship procedure — local gates, push once and watch CI, then deploy. Gates the CI/deploy traps.
disable-model-invocation: true
---

# reeve-ship

`CLAUDE.md`'s "Before you finish" as a runnable procedure. The gates here each
cost a run — or four.

## Procedure

1. **Local gates, in order:** `pnpm typecheck && pnpm lint && pnpm test`. Run
   `pnpm test:e2e` too if the change touches offline, the service worker, or a
   user flow. Note the two CI jobs share one free-tier Supabase project — `e2e`
   `needs: check` so they run sequentially; do not add a third thing that hammers
   the project concurrently.
2. **Git discipline (`CLAUDE.md`):** if on `main`, branch first. Commit only what
   is yours and only when asked. End commit messages with the Co-Authored-By
   trailer.
3. **Push once, then watch the run before pushing again.** CI has
   `cancel-in-progress: true`, so a second push cancels the first run — and a
   cancelled run does not deploy. Four consecutive "failures" were this, not
   real failures. A skipped deploy after rapid commits is that.
4. **Confirm the deploy ran.** Deploy is gated on CI via `workflow_run`; a green
   `check` + `e2e` is what triggers it.
5. **Edge Functions (only if changed):**
   `supabase functions deploy <name> --project-ref <ref>` with
   `SUPABASE_ACCESS_TOKEN` from `.env.local`. `github-webhook` is the one
   deployed **`--no-verify-jwt`** (it does its own HMAC check; the gateway's JWT
   gate would 401 GitHub before the function runs). Set any new function secrets
   the same way (Web Push needs all three VAPID values).
6. **Close out:** update the worked-from spec's `## 0. Implementation status`
   with anything the spec did not predict, and add to `CLAUDE.md` if you learned
   something that would have saved time.

## Done when

Green CI, a confirmed deploy, and the spec status + `CLAUDE.md` updated.
