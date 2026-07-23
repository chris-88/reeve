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
capable, installable. **Phase 1 Stages 0–3 are live on top of it**: areas are
owner-scoped, commitments are rows with due dates, and there is a third screen
— Due — showing what is owed and when.

| Document | Status |
|---|---|
| `docs/spec.md` | Phase 0. Shipped, but still the living reference — where any spec disagrees with it, it wins on everything outside that spec's subject. **Gitignored** — personal content |
| `docs/arc-spec-phase-1.md` | **Complete — Stages 0–5 done and deployed.** Stage 6 described but not approved |
| `docs/arc-spec-pwa-hardening.md` | P0 + P1 done, **including F7**. F8.3 was skipped and cost data — superseded by Phase 1 P1-F13. **F9, F10, F11 outstanding** |
| `docs/arc-spec-web-push.md` | **Built and deployed.** Delivery unproven until WP-F6.3 — a notification on a real iPhone |
| `docs/archive/` | Fully complete specs. Read for reasoning, do not take work from them. See `docs/archive/README.md` |

### Phase 1 — what is left

`docs/arc-spec-phase-1.md` §0 carries the full picture: what was verified, five
defects the spec did not predict, and where the document was wrong or silent.
Read it before starting anything below.

- **Phase 1 is complete.** The full loop works: a thought about the app is
  drafted into a GitHub issue (behind the `reeve` Inbox chip), reviewed and
  approved from the app, filed, and — when its PR merges — marked shipped with
  a push back. Stages 0–5 are all built and deployed; only Stage 6 (the general
  approval ledger, §8) remains, and it is described, not approved.
- **Two things in Phase 1 are proven only by hand, not by CI**, both by
  design: WP-F6.3 (a push landing on the iPhone) and the real
  GitHub→webhook→shipped→push delivery. Every function, signature, transition
  and RLS path under them is verified; only the last physical hop is manual.
- **The scheduled clustering pass is a first version** — it drafts the
  unpromoted `reeve` pile as one cluster and skips a pile over eight, recording
  the miss. Real clustering wants P1-F4 retrieval; §7 sanctions earning it
  later. The on-demand drafting path (the `reeve` chip's "Draft a change") is
  complete.
- **P1-F5 and P1-F6 are done and running.** A brief is dispatched by `pg_cron`
  at 05:10 UTC to every account with a capture in the last 30 days; the ceiling
  is checked before the model call and refuses by writing an `agent_runs` row
  and alerting. Ceilings are function secrets — `REEVE_DAILY_CEILING_USD`,
  `REEVE_MONTHLY_CEILING_USD` — defaulting to $1/day and $10/30 days.
- **P1-F13 test isolation is done.** Both suites seed their own taxonomy and
  tear down unconditionally, CI fails if a `@reeve.test` account accumulates,
  and `migrate.mjs` now refuses a migration that rewrites existing rows unless
  you pass `--yes`. Hardening F8.3 required this, was skipped, and is
  superseded by it.
- **P1-F12.2 branch protection is applied.** `main` requires the `check` and
  `e2e` jobs, blocks force-pushes and deletions, and still permits a direct
  push by an admin — so implementation sessions work as before, and CI failing
  is now a wall rather than a notification.
- **Nothing is blocked on a credential any more.** All four are in
  `.env.local` and, where a function needs them, in Supabase function secrets:
  VAPID (three values), `GITHUB_ISSUES_TOKEN`, `GITHUB_WEBHOOK_SECRET`,
  `SENTRY_DSN` / `VITE_SENTRY_DSN` / `SENTRY_AUTH_TOKEN`. Check before
  assuming one is missing.

Web Push is built and deployed — `docs/arc-spec-web-push.md` §0 records what
was verified and what was not. **Delivery has never been proven**: everything
up to the push service accepting the request is exercised, but a notification
has not arrived on a device. That is WP-F6.3 and it needs the iPhone.

A spec review on 23 July confirmed Stages 0–4 and Web Push are on the correct
path. It changed one thing: **WP-F3.4 was amended** — a brief headline may name
the single most pressing item (one sentence, a commitment's action included) on
the lock screen, chosen for utility on a single-user phone. One code follow-up
falls out of it, small and behaviour-neutral: the brief function's inline
comment claiming the headline is "about counts, not a capture's text" is wrong
and should be corrected to cite WP-F3.4 as amended. See `arc-spec-web-push.md`
§0 "Amended after review".

The inline permission ask (WP-F4.3) has no home yet either. Its moment is a
change request being filed, which is P1-F9 — build it there rather than
inventing an earlier prompt, because **a denied permission is permanent** and
asking at the wrong moment burns the only chance there is.

### Also outstanding — hardening P2

Lower priority than Phase 1, but F10 is the one with a cost today.

- **F9 Realtime resilience** — resubscribe on `visibilitychange`, handle
  `CHANNEL_ERROR`/`TIMED_OUT`, add a `user_id` filter to the subscription,
  apply the payload to the cache instead of invalidating, tear down when
  backgrounded. There are now **two** channels subscribed this way, `captures`
  and `commitments`, so the fix is worth doing once and sharing.
- **F10 Session lifecycle** — there is no sign-out. A session in a bad state is
  currently unrecoverable without developer tools, and the persisted query
  cache has to be purged with it (**but not the outbox** — unsent work belongs
  to the device, not the session). Now sharper: `areas` is owner-scoped, so
  testing it by hand needs a second account and there is no way to switch.
- **F11 Smaller items** — `useInfiniteQuery` pagination, code splitting (the
  bundle is one ~628 KB chunk), document the JWT-pattern caveat in
  `check-bundle.mjs`. The Due view fetches 200 rows the same way the Inbox
  does, so pagination now has two call sites.

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
pnpm test             # vitest, 70 tests
pnpm test:e2e         # playwright, 7 tests; builds and previews first
pnpm db:migrate       # apply supabase/migrations in order. --dry-run, --yes
pnpm db:status        # what is applied, what is pending
pnpm db:seed --owner you@example.com   # areas, from the gitignored seed file
pnpm db:backfill-commitments           # jsonb -> rows. Dry run without --apply
pnpm triage:report                     # which classifier_hint to edit first
```

Six Edge Functions now: `triage`, `send-push`, `brief`, `draft-change-request`,
`file-change-request` (plus the shared code they import). Deploy each with the
Supabase CLI as below.

Six cron jobs run in Postgres: `reeve-reap`, `reeve-sweep` and
`reeve-file-sweep` every minute, `reeve-stuck-alert` every five,
`reeve-daily-brief` at 05:10 UTC. They read their configuration from Vault
(`service_role_key`, `triage_function_url`, `brief_function_url`,
`file_change_request_url`, `sentry_dsn`) because the migrations are public.

`db:seed` refuses to run without an owner. Areas are owner-scoped, and a row
seeded without one is readable by nobody — a silent failure that looks like a
broken app rather than a missing flag.

Deploying the Edge Function is not in `package.json` because it needs the
Supabase CLI and an access token:

```sh
export SUPABASE_ACCESS_TOKEN=...        # from .env.local
supabase functions deploy triage --project-ref <ref>
supabase functions deploy send-push --project-ref <ref>
supabase functions deploy brief --project-ref <ref>
supabase functions deploy draft-change-request --project-ref <ref>
supabase functions deploy file-change-request --project-ref <ref>
supabase functions deploy github-webhook --no-verify-jwt --project-ref <ref>
```

`github-webhook` is the one function deployed **`--no-verify-jwt`**: the
Supabase gateway verifies a Supabase JWT by default, which GitHub cannot
present, so the function does its own HMAC signature check instead. Every other
function keeps the default JWT gate. The `pull_request` webhook is registered
on the repo and active; its secret is `GITHUB_WEBHOOK_SECRET`.

`file-change-request` is the only place `GITHUB_ISSUES_TOKEN` exists — a
fine-grained PAT scoped to `issues: write` on this one repo. It cannot push
code, verified (a `PUT` to contents 403s). `GITHUB_REPO` is a function secret
too, defaulting to `chris-88/reeve`.

Function secrets are set the same way. Web Push needs three, not two — signing
takes the whole keypair, so the *public* key is a function secret as well:

```sh
supabase secrets set --project-ref <ref> \
  "VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY" \
  "VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY" \
  "VAPID_SUBJECT=https://app.chrisquinn.ie"
```

---

## Things that cost hours

Each of these was learned the expensive way. They are not visible in the code.

**A public Edge Function must be deployed `--no-verify-jwt`.** Supabase's
gateway verifies a Supabase JWT on every function call by default, and returns
`401 UNAUTHORIZED_NO_AUTH_HEADER` *before the function runs*. A webhook caller
like GitHub cannot present that JWT — it sends its own HMAC signature instead —
so `github-webhook` is deployed with `--no-verify-jwt` and verifies the
signature itself. The failure looks like the function rejecting the request,
but the function never executed; check the deploy flag before debugging the
handler.

**The two CI jobs share one free-tier Supabase project, so they must not
run at once.** `check` and `e2e` both hit the live project — auth, PostgREST,
realtime, edge functions, and the model calls triage makes. Run in parallel
they put it under enough combined load that whichever job hit the contention
window failed on latency: a `beforeAll` stalling past its budget, a capture
stuck at `processing`, a sign-in hanging. The tests are green in isolation and
locally, where only one suite runs at a time — the flake was the collision. It
took five red runs to see it, because each failure moved to a different suite
and looked like a different bug. `e2e` now `needs: check`, so one suite touches
the project at a time. **The tests are coupled to a live backend by design; do
not add a third thing that hammers it concurrently without making it sequential
too.**

**Resolve a test account by signing in, not through the auth admin API.**
`admin.auth.admin.createUser` and `listUsers` (GoTrue admin) are markedly less
reliable under load than an ordinary password sign-in, and were the single
biggest source of hook timeouts. `signInTestUser` in `tests/support` signs in
first and creates only on a first-ever run; every suite uses it. A normal
`signInWithPassword` also returns the user id, so `listUsers` is gone from the
hot path.

**A shared module must not reach for one runtime's globals.**
`packages/shared` compiles against ES2022 with no DOM, because it runs in the
browser, in Deno and in Node. WinterCG globals it needs — `fetch`, `crypto`,
`console` — are declared once in `src/globals.d.ts`. Anything runtime-specific,
like reading a ceiling out of `Deno.env`, is passed in by the caller instead;
`globalThis.Deno` typechecks in the shared package and fails in `apps/web`.

**A migration that defines a function is not verified by applying it.**
plpgsql does not parse the SQL inside a function body at creation time, so
`min(id)` over a uuid column created cleanly and failed on the first cron run.
`--dry-run` does not catch it either, because the statement never executes
during the migration. **Call the function** after applying it.

**The Supabase auth admin API 403s at random.** `createUser`, `listUsers` and
`signInWithPassword` intermittently return `bad_jwt` — *"unrecognized JWT kid
&lt;nil&gt; for algorithm ES256"* — against a key that works seconds later. Roughly
one call in twenty. It reads exactly like a credential problem and is not.
Every such call goes through `retryAuth()` in `tests/support/test-accounts.ts`;
`main` now requires the CI jobs these run in, so an unretried one is a gate
that blocks merges at random.

**A migration that rewrites existing rows is refused unless you pass `--yes`.**
`scripts/migrate.mjs` runs each migration in a transaction, counts the UPDATE
and DELETE rows, and rolls back rather than applying one that touches existing
data on the first ask. `--dry-run` reports without applying. This is P1-F13.6,
and it exists because the one migration that did this ran clean, reported
success, and destroyed data.

**The test accounts had more data than the real one, and a migration believed
them.** `0003_areas_ownership.sql` had to give every existing `areas` row an
owner and could not name one — the repo is public — so it derived the account
with the most captures. The RLS suite had accumulated **24 fixture captures
against the owner's 5**, so the real areas were assigned to a test account and
the owner's own captures were unfiled by the foreign key that followed. Two
`corrected_area_id` values were lost and are not recoverable. Both suites now
seed their own invented taxonomy and clean up after themselves. **Before any
migration that infers something from the data, check what is actually in the
table** — `select u.email, count(*) from auth.users u join captures c on
c.user_id = u.id group by 1`.

**Both test suites were classifying against the owner's real taxonomy.** The
RLS and end-to-end accounts had no areas, so triage read the eight real
`classifier_hint`s — the exact exposure P1-F0 exists to close, on every CI run,
at real cost. Test accounts get their own fixtures now. If you add a suite that
triages anything, give its account its own areas including `unsorted`.

**An applied migration cannot be edited** — `scripts/migrate.mjs` compares SHA
checksums and refuses. That is why the retrieval threshold lives in `0007`
rather than in `0006` where it belongs. Get a migration right before applying
it; `pnpm db:status` shows what is pending.

**`pg_trgm.word_similarity_threshold` cannot be set in a function until the
extension's library has loaded.** Until then it is an unrecognised custom GUC,
and setting one requires superuser — which Supabase's `postgres` role is not.
A `select word_similarity('a','b');` ahead of the `create function` fixes it.
The error says "permission denied to set parameter", which sends you looking at
roles rather than at loading.

**Docker is not available on this machine.** `supabase db push` and `db dump`
shell out to it and will fail. `scripts/migrate.mjs` connects to Postgres
directly over `DATABASE_URL` instead, tracks applied migrations in
`_reeve_migrations` with SHA checksums, and is idempotent. Use it.

**Run `pnpm db:status` before naming a migration.** Tracking is by filename, so
a duplicate number is applied happily and silently — and if it sorts before the
existing one, it runs out of order too. The specs name migration numbers that
were free when they were written, not when you read them.

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
