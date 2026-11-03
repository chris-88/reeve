# Reeve — working notes for Claude sessions

Read this first. It is the handoff between sessions: what is built, what is
not, and the things that cost hours to learn and are invisible in the code.

`README.md` is for a human setting the project up. This file is for an agent
picking the work up cold.

> **Second edition, 2026-11-03.** `docs/spec.md` is the only current spec; every
> `docs/archive/arc-spec-*.md` is history. Sections below that describe the GitHub
> change-request loop, the Work board, the Inbox, or hosted Supabase describe the first
> edition and are being removed step by step in the order `docs/spec.md` §11 gives.

---

## Two kinds of session

Reeve is worked on in two distinct modes, and which one you are in is decided
by what Chris asks for — not by what seems useful.

| | **Spec session** | **Implementation session** |
|---|---|---|
| Asked for | "review this", "write a spec", "what do you think" | "implement", "build", "fix" |
| Produces | `docs/spec.md` (or a short spec beside it) | Code, tests, a deploy |
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

## Where things stand (2026-11-03, second edition)

`docs/spec.md` is the spec. Build order is its §11; E0 (the spec) and E1 (schema
consolidation, the GitHub loop retired) are done. What is live:

- **Capture → triage → Needs you → Hand to Reeve → bridge → review → Approve.**
  The bridge (`apps/bridge`, user unit `reeve-bridge.service` from `~/dotfiles`)
  claims dispatched actions as `claude@quinn`, runs `claude -p` in the domain's
  directory, writes the result back as `review`, pushes. Redo carries a note
  (`actions.feedback`); a mind dump becomes a `decompose` action the bridge
  breaks into proposed actions. `systemctl --user stop reeve-bridge` is the
  pause switch. **Stop it before `pnpm test`**: the live suite inserts
  dispatched fixtures the service would otherwise claim and run for real.
- **Domains are the vault's twelve** plus `unsorted`, in the `areas` table
  (the product says "domain"; the `domains` view is the read side). Six
  first-edition ids remain as inactive rows for old foreign keys.
- **Notifications close the loop**: hash routes (`#/needs-you/<id>` opens a
  card), a push tap lands on its card, the icon badge is the Needs you count,
  `notify-due` at 07:30 Dublin, the ask for permission after the first Go, a
  stall alert when nothing claims a dispatch in 30 minutes.
- **Gone in E1 (2026-11-03):** the change-request tables, views, enum, cron
  job, the `draft-change-request` / `file-change-request` / `github-webhook`
  functions, the GitHub webhook and the `claude.yml` workflow, the Caddy
  webhook route, the `GITHUB_*` secrets. Reeve changes itself by drafting on a
  local branch in a `reeve`-domain run; Chris ships from the machine session.
- **Still first-edition until E2:** the four-tab nav (Write · Needs you · Work ·
  Due), the Work board with its drag reorder, the separate Due screen. E2
  replaces all of `screens/` and `components/` with Capture, Today and the
  Library (spec §5); the durability libraries under `lib/` and `sw.ts` move
  across unchanged.

Two things belong to Chris and are not decided for him: the real-device check
(aeroplane mode, cold launch from the home screen on the iPhone), and anything
in spec §12.

---

## Commands

```sh
pnpm dev              # Vite dev server. No service worker here — devOptions.enabled is false
pnpm build            # tsc --noEmit, vite build, then the secret scan
pnpm typecheck        # workspace-wide, including packages/shared
pnpm lint             # eslint --max-warnings 0
pnpm test             # vitest (bridge-live hits the local stack; stop reeve-bridge first)
VITE_SUPABASE_URL=http://localhost:8001 pnpm test:e2e   # e2e against the local stack when api.chrisquinn.ie does not resolve here
pnpm test:e2e         # playwright, 7 tests; builds and previews first
pnpm db:migrate       # apply supabase/migrations in order. --dry-run, --yes  (0019 applied)
pnpm --filter @reeve/bridge start      # the bridge in the foreground (normally reeve-bridge.service)
systemctl --user status reeve-bridge   # is the bridge up; journalctl --user -u reeve-bridge -f
pnpm db:status        # what is applied, what is pending
pnpm db:seed --owner you@example.com   # areas, from the gitignored seed file
pnpm db:backfill-commitments           # jsonb -> rows. Dry run without --apply
pnpm triage:report                     # which classifier_hint to edit first
```

Four Edge Functions: `triage`, `send-push`, `brief`, `notify-due` (plus the
shared code they import). The bridge is not a function: it is a Node worker in
`apps/bridge` that talks to Postgres directly and calls `send-push` like any
other service-key caller.

Five cron jobs run in Postgres: `reeve-reap` and `reeve-sweep` every minute,
`reeve-stuck-alert` every five (stuck captures and unclaimed dispatches),
`reeve-daily-brief` at 05:10 UTC, `reeve-due-reminders` at 06:30 and 07:30 UTC
(acts at Dublin hour 7). They read their configuration from Vault
(`service_role_key`, `triage_function_url`, `brief_function_url`,
`notify_due_function_url`, `send_push_function_url`, `sentry_dsn`) because the
migrations are public.

`db:seed` refuses to run without an owner. Areas are owner-scoped, and a row
seeded without one is readable by nobody — a silent failure that looks like a
broken app rather than a missing flag.

**Backend is self-hosted (since 2026-11-02).** The Supabase stack runs on the
quinn machine at `~/code/infra/stacks/reeve/` and is reached at
`https://api.chrisquinn.ie/reeve` through a Cloudflare Tunnel. There is no
hosted project to deploy to any more; the commands below are kept for the
record. The self-hosted equivalents:

- Functions: copy `supabase/functions/<name>/` into
  `~/code/infra/stacks/reeve/volumes/functions/` (and `packages/shared` into
  `volumes/packages/shared`, because the functions import it by relative path),
  then `sudo docker compose up -d --force-recreate functions` in the stack dir.
- Secrets: `docker-compose.reeve.yml` passes them from the stack's `.env`,
  rendered by `scripts/render-env reeve` from pass (`infra/reeve/*`).
- Vault secrets (`*_function_url`, `service_role_key`, `sentry_dsn`) point at
  `http://api-gw:8000/functions/v1/...` inside the stack.
- Migrations: `pnpm db:migrate` against `DATABASE_URL` from pass
  (`env/reeve/DATABASE_URL`, now the local pooler as `postgres.reeve`).

The original hosted-deploy procedure, for reference only:

```sh
export SUPABASE_ACCESS_TOKEN=...        # from .env.local
supabase functions deploy triage --project-ref <ref>
supabase functions deploy send-push --project-ref <ref>
supabase functions deploy brief --project-ref <ref>
```

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

**A public Edge Function needs the gateway's JWT check lifted.** Supabase's
gateway verifies a Supabase JWT on every function call by default, and returns
`401 UNAUTHORIZED_NO_AUTH_HEADER` *before the function runs*. A caller that
cannot present one (the retired GitHub webhook was the case) looks like the
function rejecting the request, but the function never executed. On the
self-hosted stack the fix was a Caddy route injecting the anon key; hosted, it
was `--no-verify-jwt`. Check the gateway before debugging the handler.

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

**Use `scripts/migrate.mjs`, not `supabase db push`.** It connects to Postgres
directly over `DATABASE_URL`, tracks applied migrations in `_reeve_migrations`
with SHA checksums, and is idempotent. (Docker is on this machine now — it runs
the stack — but the Supabase CLI's push still does not fit a self-hosted pooler.)

**The local pooler refuses TLS.** Every pg script forced `ssl` and failed with
"The server does not support SSL connections" from the cutover until 2026-11-02;
they now skip TLS for a `localhost` URL. A new script that opens `pg.Client`
must do the same (`sslFor(url)` in `scripts/migrate.mjs`).

**`api.chrisquinn.ie` may not resolve from the quinn machine itself** while the
router's resolver cache holds the pre-Cloudflare answer. The live tests then
fail with `ENOTFOUND`. Run them against the stack's own port instead:
`VITE_SUPABASE_URL=http://localhost:8001 pnpm test`. The functions container is
`reeve-edge-functions`; redeploy a function by copying its source (and
`packages/shared/src`) into `~/code/infra/stacks/reeve/volumes/` and
`docker compose … up -d --force-recreate functions` there.

**A headless run can only write where `~/.claude/settings.json` allows.** The
bridge adds nothing to the allowlist. Note the vault moved from `~/vaults` to
`~/vault` on 2026-11-02; until the `Edit(...)` rule says `vault`, bridge runs
cannot file a note.

**Run `pnpm db:status` before naming a migration.** Tracking is by filename, so
a duplicate number is applied happily and silently — and if it sorts before the
existing one, it runs out of order too. The specs name migration numbers that
were free when they were written, not when you read them.

**The repo is public.** It was made public because GitHub Pages on the free
plan cannot serve a private repo. Personal content was stripped from history
with an orphan branch and a force-push. `supabase/seed/areas.json` is
gitignored and must stay that way; `docs/spec.md` is tracked since the second
edition and names domains by label only. Never commit a real area description,
a real capture, or anything from `.env.local`.

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

**Offline state in a list screen comes from `useOnline()`, not from TanStack
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
- Update `docs/spec.md`: mark the step in §11 and add one line per deviation
  to §14, including anything the spec did not predict.
- Update this file if you learned something that would have saved you time.
