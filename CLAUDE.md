# Reeve — working notes for Claude sessions

Read this first. It is the handoff between sessions: what is built, what is
not, and the things that cost hours to learn and are invisible in the code.

`README.md` is for a human setting the project up. This file is for an agent
picking the work up cold.

---

## Two kinds of session

Reeve is worked on in two distinct modes, and which one you are in is decided
by what Chris asks for — not by what seems useful.

| | **Spec session** | **Implementation session** |
|---|---|---|
| Asked for | "review this", "write a spec", "what do you think" | "implement", "build", "fix" |
| Produces | `docs/arc-spec-*.md` | Code, tests, a deploy |
| Ends with | The spec. **Do not offer to build it.** | Verified green CI and this file updated |

In a spec session, owning the spec means owning its correctness: verify every
factual claim about the codebase before writing it down, because the
implementing session picks it up cold and will trust it. Raise uncertainty as
an open question in the document rather than resolving it by building.

In an implementation session Chris does not want to write code — self-serve.
You have the credentials in `.env.local`, a migration runner, a seeder and a
deploy pipeline. Use them rather than handing back instructions.

**The governing principle, from `docs/spec.md` §1 and restated in every spec:**
features are earned by observed need, not anticipated need. Deferred work goes
in a table alongside the specific observation that would earn it.

---

## Where things stand (2026-07-22)

Phase 0 is live at `app.chrisquinn.ie`. Capture → triage → filed, offline
capable, installable.

| Document | Status |
|---|---|
| `docs/spec.md` | Phase 0. Shipped, but still the living reference — where any spec disagrees with it, it wins on everything outside that spec's subject. **Gitignored** — personal content |
| `docs/arc-spec-pwa-hardening.md` | P0 + P1 done. **F9, F10, F11 outstanding.** F7 deferred pending a Sentry DSN |
| `docs/arc-spec-phase-1.md` | Proposed. **Not approved to build** |
| `docs/archive/` | Fully complete specs. Read for reasoning, do not take work from them. See `docs/archive/README.md` |

**Outstanding, in the order the spec argues for:**

- **F9 Realtime resilience** — resubscribe on `visibilitychange`, handle
  `CHANNEL_ERROR`/`TIMED_OUT`, add a `user_id` filter to the subscription,
  apply the payload to the cache instead of invalidating, tear down when
  backgrounded.
- **F10 Session lifecycle** — there is no sign-out. A session in a bad state is
  currently unrecoverable without developer tools, and the persisted query
  cache has to be purged with it (**but not the outbox** — unsent captures
  belong to the device, not the session).
- **F11 Smaller items** — `useInfiniteQuery` pagination, code splitting (the
  bundle is one ~628 KB chunk), document the JWT-pattern caveat in
  `check-bundle.mjs`.

**Two things belong to Chris and should not be decided for him:**

1. The three open questions in `docs/archive/ui-spec.md` §9 — particularly *is the
   Inbox a log or a queue*, which the spec itself notes resolves UI-8, UI-12
   and the archive question differently depending on the answer.
2. The real-device check: aeroplane mode, cold launch from the home screen on
   the iPhone. Point 1 of the hardening spec's §5, and the one criterion no
   automated test can stand in for — see the WebKit gap below.

---

## Commands

```sh
pnpm dev              # Vite dev server. No service worker here — devOptions.enabled is false
pnpm build            # tsc --noEmit, vite build, then the secret scan
pnpm typecheck        # workspace-wide, including packages/shared
pnpm lint             # eslint --max-warnings 0
pnpm test             # vitest, 34 tests
pnpm test:e2e         # playwright, 6 tests; builds and previews first
pnpm db:migrate       # apply supabase/migrations in order
pnpm db:status        # what is applied, what is pending
pnpm db:seed          # areas, from the gitignored supabase/seed/areas.json
```

Deploying the Edge Function is not in `package.json` because it needs the
Supabase CLI and an access token:

```sh
export SUPABASE_ACCESS_TOKEN=...        # from .env.local
supabase functions deploy triage --project-ref <ref>
```

---

## Things that cost hours

Each of these was learned the expensive way. They are not visible in the code.

**Docker is not available on this machine.** `supabase db push` and `db dump`
shell out to it and will fail. `scripts/migrate.mjs` connects to Postgres
directly over `DATABASE_URL` instead, tracks applied migrations in
`_reeve_migrations` with SHA checksums, and is idempotent. Use it.

**The repo is public.** It was made public because GitHub Pages on the free
plan cannot serve a private repo. Personal content was stripped from history
with an orphan branch and a force-push. `docs/spec.md` and
`supabase/seed/areas.json` are gitignored and must stay that way. Never commit
a real area description, a real capture, or anything from `.env.local`.

**Cron credentials live in Supabase Vault, not in the migration.**
`0002_triage_guarantee.sql` reads `vault.decrypted_secrets` for
`triage_function_url` and `service_role_key`. They were set out of band,
because the migration file itself is public.

**The Edge Function needs its own `deno.json`.** A bare
`@supabase/supabase-js` import is rejected by the bundler without an import
map, and the map must live in `supabase/functions/triage/`, not in
`supabase/functions/`.

**`SUPABASE_SECRET_KEY` cannot be set as a function secret** — the `SUPABASE_`
prefix is reserved. The function falls back to the auto-injected
`SUPABASE_SERVICE_ROLE_KEY`.

**The CORS allowlist must include the headers `supabase-js` actually sends:**
`authorization, apikey, content-type, x-client-info, x-supabase-api-version`.
Missing `apikey` and `x-client-info` stranded every capture at `queued` for a
day. It was invisible because server-side callers — the cron sweeper, the
tests — skip CORS entirely, so every automated check passed.

**Auth is email and password, with signups disabled.** Magic links were
abandoned: template customisation is blocked on the free tier and
`rate_limit_email_sent` is 2 per hour, which is unusable for a single-user app.

**Deploy is gated on CI via `workflow_run`.** CI has
`cancel-in-progress: true`, so two pushes in quick succession cancel the first
run — and a cancelled run does not deploy. A skipped deploy after rapid commits
is that, not a failure. **Push once, then watch the run before pushing again.**
Four consecutive CI failures were caused by stacking commits without watching
the first one.

**Playwright builds and previews rather than using the dev server**, because
the service worker does not exist in dev. If you see a suite pass with no
offline behaviour, check you have not left a stale `pnpm dev` on port 5173.

**Both offline e2e tests skip on WebKit.** Playwright's WebKit throws an
internal error on a reload while offline. Chromium passes the same assertions,
so this is a harness limitation — but offline behaviour on the engine the app
actually ships to is not covered by CI.

**`packageManager` must stay pinned** in the root `package.json`.
`pnpm/action-setup` fails with "No pnpm version is specified" without it.

**Node's type-stripping cannot resolve `.js` import specifiers** in the
scripts; they use `.ts` extensions with `allowImportingTsExtensions`.

---

## Invariants — do not break these without a spec change

**Captures are never dropped.** A capture the model cannot confidently place is
routed to `unsorted`, not failed. A misfiled thought is recoverable; a lost one
is only discovered when you need it.

**The field clears only after the write is durable.** `Capture.save()` awaits
`enqueue()` before calling `setText("")`. On failure the text stays and an
error toast fires. There is no success toast — the departure animation is the
acknowledgement.

**`navigator.onLine` is for display, never for gating.** It reports true behind
a captive portal and false during some VPN transitions; as a gate it blocks
syncs that would have worked. The outbox flushes and lets the request fail.
`useOnline()` exists to tell the user what is happening, which is a different
job from deciding whether to try.

**Offline state in the Inbox comes from `useOnline()`, not from TanStack
Query's `fetchStatus`.** After a persisted cache restore the query settles to
`idle` rather than `paused`, so `fetchStatus` read as online and the app fell
through to "Nothing captured yet" — the exact failure F2 exists to prevent.

**Re-filing is a signal, not a correction.** Changing an area writes
`corrected_area_id` and leaves the model's original choice intact. The gap
between the two is the only honest evidence about whether the taxonomy works.

**The service worker never auto-updates** (`registerType: "prompt"`). Swapping
the bundle under someone mid-sentence is precisely the data loss the hardening
work exists to prevent.

**One origin.** `base: "/"`, `manifest.id: "/"`. Service worker scope, manifest
identity and storage partitioning are all origin-bound, so serving one build
from two URLs produces two installations with two separate data stores.

**`pnpm build` fails if a secret reaches `dist/`** — `scripts/check-bundle.mjs`
scans for Anthropic keys, Supabase secret keys and access tokens, Postgres
URLs with passwords, and JWTs. It has been verified with a planted key.

---

## Secrets

Everything secret is in `.env.local`, which is gitignored. **Never paste a
secret into a chat transcript** — a database password and a generated app
password both ended up in transcripts on this project and had to be rotated.
If one appears, say so plainly and rotate it; do not let it pass.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are public by design and ship
in the bundle. They are stored as repository *variables*, not secrets.

---

## Before you finish

- `pnpm typecheck && pnpm lint && pnpm test` locally.
- Push once, watch CI, confirm the deploy ran.
- Update the status section of whichever spec you worked from — including
  anything you found that the spec did not predict. Both existing specs carry
  a `## 0. Implementation status`; follow that shape.
- Update this file if you learned something that would have saved you time.
