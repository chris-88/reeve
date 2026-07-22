# Reeve: Architecture Spec — PWA Hardening

Status: **P0 and P1 complete and deployed.** P2 outstanding.
Owner: spec-owned. Implementation runs in separate sessions — where this
document is wrong, ambiguous or silent, raise it against the spec rather than
deciding it in the diff.
Supersedes: nothing. Extends `docs/spec.md` (Phase 0)
Audience: implementing dev team

---

## 0. Implementation status

Every factual claim in this document was verified against the code before any
change was made. All of them held.

| | Feature | Status |
|---|---|---|
| P0 | **F3** Durable capture | ✅ Done |
| P0 | **F0** Single origin | ✅ Done |
| P0 | **F1** Offline application shell | ✅ Done |
| P0 | **F2** Offline read path | ✅ Done |
| P1 | **F4** Outbox reliability | ✅ Done |
| P1 | **F5** Triage completion guarantee | ✅ Done |
| P1 | **F6** Install and platform metadata | ✅ Done |
| P1 | **F7** Observability | ✅ Done |
| P1 | **F8** CI gates | 🔶 Done except **F8.3** — see below |
| P2 | **F9** Realtime resilience | ⬜ Not started |
| P2 | **F10** Session lifecycle | ⬜ Not started |
| P2 | **F11** Smaller items | ⬜ Not started |

### Verified against the acceptance criteria

- Offline cold load renders the capture screen; a capture taken offline
  survives a reload and reaches `done` on reconnect. Covered by
  `e2e/offline.spec.ts`.
- A row inserted directly into the database with `status = 'queued'` and no
  invoke reached `done` in **30 seconds** via the `pg_cron` sweeper.
- 34 unit tests and 6 end-to-end tests pass. CI runs typecheck, lint, unit
  tests, build and Playwright on both Chromium and WebKit; deploy is gated on
  it.

### Three defects found during implementation that this spec did not predict

1. **`flush()` did not resolve when the work was done.** It returned as soon as
   another flush held the latch, so `await flush()` meant "someone else is
   working on it". Four of the new F4.9 unit tests failed on this before it was
   fixed — which is the clearest possible argument for F4.9 having been worth
   doing.
2. **`clients.claim()` was missing from the service worker.** Without it a
   newly installed worker does not control the page that registered it, so the
   *first* session after install had no offline capability at all.
3. **A `<label>` with no associated control**, introduced while fixing F11.3
   and caught by `jsx-a11y` within minutes of F8.6 landing.

### F8.3 was skipped, and it cost data

Corrected 22 July 2026 by the spec owner.

F8.3 requires *"a dedicated test project or a clearly-scoped set of test users
— do not point CI at the project holding real captures."* Neither half was
implemented, and F8 was marked done regardless. The consequences surfaced in
the next round and are recorded in `docs/arc-spec-phase-1.md` §0: both suites
were classifying fixtures against the owner's real `classifier_hint`s on every
CI run, and a migration deriving ownership from row counts picked the test
account — destroying two `corrected_area_id` signals unrecoverably.

The decision has now been taken explicitly: **scoped accounts in one project**,
specified as `arc-spec-phase-1.md` P1-F13, which supersedes F8.3. Treat that
feature as the live requirement; this entry stands as the record of what
marking a partially-met requirement "done" cost.

### Known gaps

- **The offline test is skipped on WebKit.** Playwright's WebKit throws an
  internal error on a reload while offline, so it cannot exercise a
  service-worker-served navigation. Chromium passes the same assertions, so
  this is a harness limitation — but offline behaviour on the engine the app
  actually ships to is **not covered by CI** and needs a manual check on a
  device.
- **Point 1 of §5 has not been verified.** Aeroplane mode, cold-launched from
  the home screen on a real iPhone, is the one criterion no automated test can
  stand in for.
- **F7 is deferred**, so §5 point 5 — a stuck capture raising an alert — is
  not met. The `pg_cron` sweeper means a capture no longer *gets* stuck in the
  ways this document described, but nothing would report it if one did.

---

## 1. Why this exists

Phase 0 shipped and meets its stated definition of done: a thought typed into
the PWA is classified, titled, summarised and filed within fifteen seconds.

It does not meet its *implied* one. Three claims are made repeatedly — in the
README, in `docs/spec.md` §7, and in the code comments — that are currently
false:

| Claim | Reality |
|---|---|
| "Saving is local-first… the network on a building site is not a given" | There is no service worker. Offline, the app shell does not load at all, so the local-first queue never runs |
| "Captures are never dropped" | `save()` clears the input before the write is durable, and a capture whose triage call fails is never retried |
| "Installable to a phone home screen" | Installable, yes. Offline-capable, no. These are different things |

This spec closes that gap. It is deliberately **not** a feature phase. Every
item here makes an existing promise true, fixes a correctness defect, or
removes a piece of config that will be expensive to change later. Nothing here
adds a capability the system does not already claim to have.

The one exception is §4, which lists work that is explicitly *not* being done
now, but which constrains decisions taken here.

### The governing principle still applies

`docs/spec.md` states: **features are earned by observed need, not anticipated
need.** That principle is about *features*. It is not a licence to ship a
durability guarantee that does not hold. The items below are the cost of the
claims already made, not anticipation of new ones.

---

## 2. Features

Each feature is independently shippable and independently reviewable.
Requirements are numbered for reference in PRs. Acceptance criteria are the
gate — a feature is done when its criteria are demonstrably met, not when the
code is written.

Priority: **P0** blocks the others or fixes active data loss. **P1** is
required for this spec to be complete. **P2** is desirable in the same body of
work but may be split out.

---

### F1 — Offline application shell

**Priority:** P0 · **Depends on:** F0 (below) · **Blocks:** F2, and everything in §4

The app must load and function without a network. Today it does not load at
all.

#### Prerequisite: F0 — commit to a single origin

Before any service worker work, the dual-URL deployment must be resolved.

`apps/web/vite.config.ts` sets `base: "./"` so one build serves both
`app.chrisquinn.ie` and `chris-88.github.io/reeve/`. That was a reasonable call
when nothing depended on origin identity. It stops being reasonable now:
service worker scope, manifest `id`, push subscription endpoints and storage
partitioning are all origin- and path-bound. An app installed from one URL and
an app installed from the other become two different installations with two
different data stores.

- **F0.1** Deployment targets `https://app.chrisquinn.ie` only. `public/CNAME`
  already reflects this.
- **F0.2** Set `base: "/"` in `apps/web/vite.config.ts` and delete the comment
  explaining the relative-path workaround.
- **F0.3** Confirm the GitHub Pages project URL either redirects to the custom
  domain or is documented as unsupported. Do not leave it serving a second,
  divergent installation.

#### Requirements

- **F1.1** Add `vite-plugin-pwa` to `apps/web`. Generate the service worker at
  build time; do not hand-write one.
- **F1.2** Use `registerType: "prompt"`. Auto-update is prohibited: swapping
  the JS bundle under someone who is mid-sentence is precisely the failure this
  spec exists to prevent.
- **F1.3** Precache the application shell — HTML, JS, CSS, fonts, icons. The
  current build is ~800 KB total; there is no reason to be selective.
- **F1.4** Runtime caching strategy, by route:

  | Request | Strategy | Rationale |
  |---|---|---|
  | Navigation | `NetworkFirst`, falling back to the precached shell | The shell must boot with no network |
  | `*.supabase.co/rest/v1/areas*` | `StaleWhileRevalidate`, 30-day expiry | Areas change roughly never. The inbox is unreadable without them — every row's colour and label comes from here |
  | `*.supabase.co/rest/v1/captures*` | `NetworkFirst`, 5s timeout, 24h expiry | A stale inbox beats an empty one. F2 is the primary mechanism; this is defence in depth |
  | `*.supabase.co/auth/v1/*` | **Never cached** | Caching an auth response is a security defect |
  | `*.supabase.co/functions/v1/*` | **Never cached** | Non-idempotent from the client's perspective |
  | `wss://*` | Not applicable | Realtime is unavailable offline by definition. See F9 |

- **F1.5** The service worker must never cache a response carrying an
  `Authorization` header's result beyond the row data itself, and must never
  serve a cached authenticated response to a different user. Since Reeve is
  single-user this is theoretical today; state it in code so it stays true.
- **F1.6** Implement an update prompt. When a new service worker is waiting,
  show a non-modal, dismissible affordance. Applying it must be an explicit
  user action, and must be refused while the capture field is non-empty or the
  outbox is non-empty.
- **F1.7** Delete `apps/web/public/404.html`. It is copied verbatim from
  `public/`, is never processed by Vite, and therefore still references
  `/src/main.tsx` — a dev-only path. The built file renders a blank page. The
  navigation fallback in F1.4 replaces it entirely.

#### Acceptance criteria

- With the browser set to offline, a cold load of `https://app.chrisquinn.ie`
  renders the capture screen. Not an error page, not a blank page.
- A capture typed while offline is written to the outbox and visible in the
  pending list.
- Restoring the network syncs it without a reload.
- Lighthouse "Installable" and "Works offline" both pass.
- A deployed update does not apply itself while text is in the capture field.

---

### F2 — Offline read path

**Priority:** P0 · **Depends on:** F1

The write path is local-first. The read path is not, and fails in the worst
possible way.

`apps/web/src/screens/Inbox.tsx` uses TanStack Query with default settings.
`networkMode` defaults to `"online"`, so offline the query enters `paused`
rather than `loading`. `isLoading` is therefore `false`, execution falls
through to the empty state, and **the app tells the user they have no captures
at all.** Silently reporting an empty inbox to someone who has been capturing
all week is worse than an error.

#### Requirements

- **F2.1** Persist the query cache. Use
  `@tanstack/react-query-persist-client` with
  `@tanstack/query-async-storage-persister` backed by `idb-keyval`. Do not use
  `localStorage` — the capture list will exceed its practical size limit and
  the writes are synchronous on the main thread.
- **F2.2** Persist the `captures` and `areas` queries only. Never persist
  anything derived from an auth response.
- **F2.3** Set `maxAge` on the persister to 7 days. Set a `buster` key tied to
  the build hash so a schema change cannot resurrect incompatible cached rows.
- **F2.4** Purge the persisted cache on sign-out (see F10).
- **F2.5** Distinguish three states in the Inbox and render each differently:
  *loading*, *offline with cached data* (show the data, plus a quiet indicator
  that it may be stale), and *genuinely empty*. The current code collapses all
  three into the empty state.
- **F2.6** Do not set `networkMode: "always"` globally as a shortcut. It makes
  mutations fire into a void. Fix the state handling instead.

#### Acceptance criteria

- Load the app online, sign in, view the inbox. Go offline. Cold-reload. The
  same captures are listed.
- The offline inbox never displays "Nothing captured yet" when cached rows
  exist.
- Signing out and back in as a different user shows no trace of the previous
  user's rows.

---

### F3 — Durable capture

**Priority:** P0 · **Depends on:** nothing

This is the active data-loss defect. It should be fixed first regardless of
sequencing elsewhere.

`apps/web/src/screens/Capture.tsx`:

```ts
setText("");
localStorage.removeItem(DRAFT_KEY);
await enqueue(value);          // if this throws, the thought is gone
```

If `enqueue` rejects — IndexedDB quota exceeded, Safari private mode, storage
evicted mid-write — the text has already been cleared from both state and the
draft. It is unrecoverable. This is the one failure the README says cannot
happen.

#### Requirements

- **F3.1** Reorder: `await enqueue(value)` must resolve before the field is
  cleared and before the draft key is removed.
- **F3.2** On `enqueue` rejection: retain the text, keep the draft, and surface
  a directive error. Per `docs/spec.md` §7, failure states are directive, not
  apologetic — "Couldn't save that. Your text is still here." not "Something
  went wrong."
- **F3.3** Disable the capture button while the enqueue is in flight so a
  double tap cannot produce two rows.
- **F3.4** Wrap every `localStorage` access in the draft path with try/catch.
  `localStorage.setItem` throws on quota exhaustion and in some privacy modes;
  today that throw happens inside a `useEffect` and takes down the render.
- **F3.5** Call `navigator.storage.persist()` once after successful sign-in,
  and log the boolean result. Without it, Safari evicts IndexedDB and
  `localStorage` after roughly seven days of non-use and under storage
  pressure sooner. Both the outbox and the draft live in evictable storage
  today.
- **F3.6** Surface persistent-storage denial. If `persist()` returns `false`,
  the durability guarantee is weaker than advertised and the user should be
  able to find that out — a line in a settings or diagnostics view is enough.
  Do not interrupt capture with it.

#### Note for the implementer: an existing test asserts the bug

`e2e/capture.spec.ts` currently contains:

```ts
// Feedback must be immediate — the field clears before the network is touched.
await expect(page.getByLabel("Capture a thought")).toHaveValue("");
```

The *intent* of that assertion is correct and must be preserved: saving must
never wait on the network. The *comment* describes the defect. `enqueue` is a
local IndexedDB write taking well under a millisecond, so awaiting it does not
introduce a network wait. Update the comment to "the field clears as soon as
the capture is durable locally" and keep the assertion. Do not weaken it to a
polled wait.

#### Acceptance criteria

- With IndexedDB writes forced to reject, tapping Capture leaves the text in
  the field and shows an error. Nothing is lost.
- A rapid double tap produces exactly one outbox item.
- `navigator.storage.persisted()` returns `true` after sign-in on a supporting
  browser.

---

### F4 — Outbox reliability

**Priority:** P1 · **Depends on:** F3

`apps/web/src/lib/outbox.ts` is the most safety-critical module in the app and
has no unit tests. Its design is sound — client-generated UUIDs make retries
idempotent, which is the hard part and it was got right. The defects are all in
the mechanics around it.

#### Requirements

- **F4.1** Make queue mutations atomic. `enqueue` and `flush` both perform
  read → mutate → write without a transaction. Use `idb-keyval`'s `update()`,
  which does the whole cycle inside one IndexedDB transaction.
- **F4.2** Bound every network call. supabase-js issues `fetch` with no
  timeout. On a degraded connection — a captive portal, one bar of signal — a
  hung request holds the module-scoped `flushing` latch, and because that latch
  is only cleared in `finally`, **no subsequent flush runs until the app is
  reloaded.** Pass an `AbortSignal.timeout()` (15s suggested) to every request
  in the flush path.
- **F4.3** Add a watchdog to the `flushing` latch as a second line of defence:
  if a flush has been in flight beyond a hard ceiling, release the latch and
  log it. A stuck latch is silent, and silence is the failure mode this whole
  spec is about.
- **F4.4** Implement exponential backoff per item, keyed off the existing
  `attempts` field: 1s, 4s, 15s, 60s, then 5-minute intervals, with jitter.
  Today `attempts` is incremented and displayed but gates nothing, so a poison
  item re-fires on every foreground event forever.
- **F4.5** Introduce a dead-letter state. After N attempts (suggest 10), stop
  automatic retries, mark the item as needing attention, and require an
  explicit user retry. Never delete it. Never drop it silently.
- **F4.6** Remove `navigator.onLine` as a *skip* condition. It reports `true`
  on a captive portal and `false` during some VPN transitions, so as a gate it
  produces false negatives that block sync when sync would have worked. A
  failed insert is already handled gracefully; just attempt. Keep the `online`
  *event* as a trigger — that use is sound.
- **F4.7** Stop calling `supabase.auth.getUser()` in `flush()`. It is a network
  round-trip issued precisely when the network is the problem. Record `user_id`
  on the item at `enqueue` time instead. This also fixes a correctness bug: a
  capture queued by one user and flushed after a different sign-in is currently
  attributed to the wrong account.
- **F4.8** Add a periodic flush timer (suggest 60s) while the document is
  visible. The current triggers — `online` and `visibilitychange` — both miss
  the case of an app left open on a desktop while connectivity returns without
  firing an `online` event.
- **F4.9** Unit-test this module. Vitest, fake IndexedDB, mocked Supabase
  client. Minimum coverage: idempotent replay after a lost response
  (`23505`); backoff schedule; dead-lettering; the atomicity of concurrent
  `enqueue` during `flush`; latch release on timeout. This is the one module
  where a mock is the right tool, because the behaviour under test is the
  client's own state machine.

#### Acceptance criteria

- With the network throttled to hang indefinitely, the app recovers and syncs
  once the network is restored, without a reload.
- An item that will never insert (forced constraint violation) stops retrying,
  is visible to the user, and is not deleted.
- Two `enqueue` calls issued during an in-flight `flush` both survive.

---

### F5 — Triage completion guarantee

**Priority:** P1 · **Depends on:** nothing

`supabase/functions/triage/index.ts` defines `MAX_ATTEMPTS = 3` and resets
status to `queued` on failure. Nothing ever re-invokes it. The only caller is
`outbox.ts`, fired once immediately after insert and swallowed on error.

The consequence: `attempts` can never exceed 1, the retry ceiling is dead code,
and any capture whose triage fails — or whose invoke never lands because
connectivity dropped in the window between insert and invoke — **sits at
`queued` indefinitely.** The inbox shows "Filing…" forever.

#### Requirements

- **F5.1** Add a compare-and-swap lock to the Edge Function. The current
  unconditional `update({ status: 'processing' })` lets two concurrent
  invocations both read `queued` and both call the model — double spend, two
  `agent_runs` rows, last-write-wins on the result. Change to a conditional
  update filtered on `status = 'queued'` with `.select()`, and return early
  when zero rows come back.
- **F5.2** Add a reaper for stuck `processing` rows. A function that crashes
  after the CAS leaves the row locked forever. Any row in `processing` older
  than a threshold (suggest 5 minutes) is eligible to return to `queued`.
- **F5.3** Add a server-side sweeper. A `pg_cron` job, running every minute,
  invokes triage for rows where `status = 'queued'`, `attempts < 3`, and the
  last attempt is older than a backoff interval. This is the mechanism that
  makes `MAX_ATTEMPTS` mean something.
- **F5.4** Add the supporting index:
  `create index captures_pending on captures (status, updated_at) where status in ('queued','processing');`
- **F5.5** Add a user-facing retry on `failed` captures in
  `CaptureDetail.tsx`. Exhausting three server-side attempts should not be
  terminal — the failure may have been a transient model outage.
- **F5.6** Restrict the Edge Function's CORS `Access-Control-Allow-Origin` to
  the app origin. `"*"` is currently set. The endpoint is auth-gated so the
  exposure is low, but there is no reason for it.
- **F5.7** Consolidate the two Supabase clients in the function. `caller` and
  `db` are constructed with identical arguments; one is sufficient, and two
  invites a future edit that gives them different privileges by accident.

#### Acceptance criteria

- Force the model call to fail. The capture reaches `failed` after exactly
  three attempts, with three `agent_runs` rows, and each attempt is separated
  by backoff rather than fired in a burst.
- Insert a row directly into the database with `status = 'queued'` and no
  invoke. It is triaged within two minutes.
- Kill a function mid-run. The row returns to `queued` and completes.
- Two simultaneous invocations for the same capture produce exactly one model
  call.

---

### F6 — Install and platform metadata

**Priority:** P1 · **Depends on:** F0

Configuration that is cheap now and expensive later, because installed clients
carry it.

#### Requirements

- **F6.1** Add `id` to the manifest, set to a stable literal (`"/"` given F0).
  Without it, app identity is derived from `start_url`; changing `start_url`
  later orphans every existing installation and produces a duplicate app rather
  than an update. This is the single highest-cost-to-defer item in this
  feature.
- **F6.2** Ship two distinct icon assets. `icon-512.png` is currently declared
  `"purpose": "any maskable"`. One asset cannot serve both: a maskable icon
  requires roughly 40% safe-zone padding, so either it is clipped on Android or
  it floats undersized elsewhere. Produce a padded maskable variant and declare
  the two purposes separately.
- **F6.3** Remove `"orientation": "portrait"`. `docs/spec.md` §7 makes desktop
  a first-class target; locking orientation contradicts it.
- **F6.4** Add `description`, `lang`, `dir`, `categories`, and
  `display_override: ["standalone", "minimal-ui"]`.
- **F6.5** Add `screenshots` with `form_factor` set for both narrow and wide.
  Without them the Android install prompt falls back to its minimal
  presentation.
- **F6.6** Remove `maximum-scale=1` from the viewport meta in `index.html`. It
  blocks pinch-zoom, which is a WCAG 1.4.4 failure. It exists as a legacy
  workaround for iOS zooming on input focus; that is already prevented by the
  ≥16px input font sizes in use.
- **F6.7** Add `<meta name="mobile-web-app-capable" content="yes">` alongside
  the existing `apple-`prefixed tag. The prefixed form is deprecated; ship both
  until it is safe to drop the old one.
- **F6.8** Make `theme-color` responsive to colour scheme via `media`
  attributes, even though the app is dark-only today. If a light mode ever
  ships, the status bar is otherwise wrong on every installed client until they
  reinstall.
- **F6.9** Resolve the `next-themes` dependency. It is imported only by
  `components/ui/sonner.tsx`, there is no `ThemeProvider` mounted, and the
  `dark` class is hardcoded on `<html>`. Either mount the provider or remove
  the dependency and hardcode the toast theme. Leaving `useTheme()` returning
  undefined is a latent inconsistency.

#### Acceptance criteria

- Manifest validates with no warnings in Chrome DevTools → Application.
- The maskable icon renders correctly in the Chrome maskable-icon preview at
  every mask shape.
- Pinch-zoom works on iOS Safari and in the installed app.

---

### F7 — Observability

**Priority:** P1 · **Depends on:** nothing

`docs/spec.md` §4 mandates Sentry in both the web app and the Edge Function.
Neither has it. Every failure mode described in this document is currently
silent — an outbox that wedges in a pocket, a capture stuck at `queued`, a
service worker that fails to activate. The system's core promise is durability,
and there is no instrument that would tell you it had been broken.

#### Requirements

- **F7.1** Add Sentry to `apps/web`. Capture unhandled rejections, which is
  where the outbox's `void flush()` failures currently vanish.
- **F7.2** Add Sentry to the triage Edge Function. Attach `capture_id` and
  `attempt` to every event.
- **F7.3** Enable `build.sourcemap` in `apps/web/vite.config.ts` and upload
  maps to Sentry during CI. Do not deploy the `.map` files to Pages. Note that
  `scripts/check-bundle.mjs` already scans `.map` files, so the safety net
  covers them the moment they exist.

  **The Sentry org is in the EU region.** `sentry-cli` and `@sentry/vite-plugin`
  default to `sentry.io`, which is US, and against an EU org that fails as
  "project not found" — a message that sends you looking at the project slug
  rather than the region. The CI variables are already set: `SENTRY_ORG` is
  `personal-kyp`, `SENTRY_PROJECT` is `reeve`, and **`SENTRY_URL` is
  `https://de.sentry.io`**. Pass all three; do not rely on auto-detection.
- **F7.4** Scrub `raw_text` from all telemetry. Captures are personal by
  definition — the same reasoning that put `areas.json` behind `.gitignore`
  applies with more force here. Send `capture_id` and never content.
- **F7.5** Add explicit breadcrumbs for the durability path: enqueue, flush
  attempt, flush outcome, dead-letter, service worker activation, service
  worker update applied.
- **F7.6** Define one alert: a capture in `queued` or `processing` for more
  than 15 minutes. That is the condition the user would otherwise discover
  weeks later, when they went looking for the thought.
- **F7.7** **Teach `scripts/check-bundle.mjs` about Sentry's two credentials.**
  Add `SENTRY_AUTH_TOKEN` to `SECRETS`, and `/sntrys_[A-Za-z0-9_-]{10,}/` to
  `PATTERNS`. Neither exists today, and the existing JWT pattern does not cover
  it: a Sentry organisation token is `sntrys_` followed by a single base64
  blob with no dot-separated segments, so `\beyJ…\.…\.…` never matches.

  This is not hypothetical. During credential provisioning the auth token was
  pasted into `SENTRY_DSN`, one step away from `VITE_SENTRY_DSN` — and a
  `VITE_`-prefixed variable is compiled into the bundle and published to
  GitHub Pages. `pnpm build` would not have failed. The DSN is public by
  design and the token is not, they are configured minutes apart, and the
  script that exists to catch exactly this class of mistake was blind to it.

#### Acceptance criteria

- A forced client exception appears in Sentry with a symbolicated stack.
- A forced Edge Function failure appears with `capture_id` attached.
- A build with the auth token in any `VITE_` variable fails `check-bundle.mjs`.
- No event payload contains capture text. Verify by inspection, not assumption.

---

### F8 — CI gates

**Priority:** P1 · **Depends on:** nothing

`.github/workflows/deploy.yml` runs `pnpm build` and publishes. `pnpm build`
runs `tsc --noEmit` for `apps/web` only. No Vitest, no typecheck of
`packages/shared`, and no workflow runs on pull requests at all. Untested code
reaches production on every push to `main`.

#### Requirements

- **F8.1** Add `.github/workflows/ci.yml`, triggered on pull request and on
  push to `main`: install, `pnpm typecheck` (workspace-wide), `pnpm test`,
  build.
- **F8.2** Gate the `deploy` job on CI passing.
- **F8.3** Move the Vitest suites onto CI. They hit the real Supabase project,
  so they need a dedicated test project or a clearly-scoped set of test users —
  do not point CI at the project holding real captures.
- **F8.4** Add Playwright to CI with a `webkit` project. `playwright.config.ts`
  already documents that WebKit was dropped only because the local machine
  cannot install its dependencies without root, and that GitHub's runners can.
  The app targets iOS Safari; the suite should run against it.
- **F8.5** Add an offline scenario to the e2e suite: capture with the context
  offline, restore connectivity, assert the row lands and reaches `done`. This
  is the acceptance test for F1 through F4 together and cannot be exercised by
  the current suite at all.
- **F8.6** Add ESLint and Prettier. There is no linter or formatter in the
  repo. Include `eslint-plugin-jsx-a11y` — several accessibility issues in this
  spec are ones a linter would have caught.
- **F8.7** Enable Dependabot or Renovate, grouped and scheduled weekly.

#### Acceptance criteria

- A pull request with a type error, a failing test, or a lint violation cannot
  be merged.
- A push to `main` that fails CI does not deploy.

---

### F9 — Realtime resilience

**Priority:** P2 · **Depends on:** nothing

`Inbox.tsx` subscribes to a Realtime channel once, on mount, and never
re-subscribes. iOS suspends WebSockets in backgrounded PWAs, so after the phone
goes in a pocket the channel is dead. Nothing detects this and nothing tells
the user. The inbox simply stops updating.

#### Requirements

- **F9.1** Re-subscribe on `visibilitychange` when the document becomes
  visible, and invalidate the captures query at the same time to close the gap.
- **F9.2** Handle `CHANNEL_ERROR` and `TIMED_OUT` from `.subscribe()`, with
  bounded reconnect backoff. The callback's status argument is currently
  ignored.
- **F9.3** Add `filter: user_id=eq.<uid>` to the subscription. RLS already
  scopes what is delivered; the filter reduces wasted traffic and makes the
  intent explicit at the call site.
- **F9.4** Apply the Realtime payload to the cache directly rather than
  invalidating. Today every status transition triggers a refetch of up to 200
  rows; a single capture moving `queued → processing → done` causes three full
  refetches.
- **F9.5** Tear down the channel when the app is backgrounded for an extended
  period, rather than leaving a dead socket that holds a connection slot.

#### Acceptance criteria

- Background the installed app for ten minutes, foreground it, insert a row
  server-side. It appears without a reload.
- A single capture completing triage causes no full-list refetch.

---

### F10 — Session lifecycle

**Priority:** P2 · **Depends on:** F2

There is no sign-out anywhere in the application. `grep` for `signOut` returns
nothing. A session in a bad state is unrecoverable without developer tools,
and with F2 there is now persisted data that must be cleared with it.

#### Requirements

- **F10.1** Add a sign-out affordance.
- **F10.2** Sign-out must clear, in order: the persisted query cache, the
  draft key, and the Supabase session. It must **not** clear the outbox — an
  unsynced capture belongs to the user who wrote it and survives sign-out. Show
  a confirmation if the outbox is non-empty.
- **F10.3** Handle refresh-token failure explicitly. A token that cannot be
  refreshed after an extended offline period currently produces silent query
  failures rather than a return to the sign-in screen.
- **F10.4** Add password reset. There is no recovery path today. Note the
  constraint already documented in `SignIn.tsx`: the free tier permits two auth
  emails per hour, and on iOS a link opens in Safari rather than the installed
  PWA.

#### Acceptance criteria

- Sign out, sign in as another user. No rows, drafts or cached queries from
  the first user are visible.
- Sign out with a pending outbox item. The item is still pending after signing
  back in as the same user.

---

### F11 — Smaller items

**Priority:** P2

- **F11.1** `Inbox.tsx` caps at `limit(200)` with no pagination and no
  indication of truncation. Move to `useInfiniteQuery` with a keyset cursor on
  `created_at`. The `captures_by_user_time` index already supports it.
- **F11.2** The capture textarea sets no `enterkeyhint`, `autocapitalize`, or
  `spellcheck`. Set them deliberately for a dictation-first field.
- **F11.3** The tap-target div in `Capture.tsx` carries an `onClick` with
  `role="presentation"` and no keyboard equivalent. Harmless in practice
  because the textarea inside is focusable, but it will fail F8.6's a11y lint.
  Resolve it properly rather than suppressing the rule.
- **F11.4** No code splitting: `index.js` is a single 628 KB chunk. Split the
  Supabase client and the dialog/detail path. Not urgent at this size, but the
  cost only rises.
- **F11.5** Document the `check-bundle.mjs` JWT pattern caveat. It flags any
  `eyJ...` string, which would fire on a legacy-format Supabase anon key. The
  project uses the newer `sb_publishable_` format so it does not fire today,
  but the failure would be baffling to whoever hits it.

---

## 3. Sequencing

```
F3  Durable capture ──────────────┐   ship first, independently
                                  │   fixes active data loss
F0  Single origin ───► F1  SW ────┼──► F2  Offline read
                                  │
F5  Triage guarantee ─────────────┤   independent, high value
F7  Observability ────────────────┤   do early — it measures the rest
F8  CI gates ─────────────────────┘

then: F4 (outbox), F6 (manifest), F9, F10, F11
```

Three notes on ordering:

**F3 first, alone.** It is a small change to one function and it stops live
data loss. It should not wait behind a service worker.

**F7 early, not last.** Observability that arrives after the fixes cannot tell
you whether the fixes worked. Landing Sentry before F1–F5 means the durability
work is measured rather than assumed.

**F0 before F1, without exception.** Deciding origin identity after clients
have installed a service worker is a migration. Deciding it before is a
one-line config change.

---

## 4. Explicitly not now

These are **not** in scope. They are recorded because F1 is their prerequisite,
and because the point of doing F1 properly is that each of these later becomes
a small piece of work rather than a rearchitecture.

Per the governing principle, none of these ship until an observed need earns
them.

| Capability | Requires | Earned when |
|---|---|---|
| **Web Push** | Service worker (F1), VAPID keys, `Notification.requestPermission()` from a user gesture. iOS 16.4+, installed apps only | Phase 1's approval gate needs a delivery channel. "Agents draft, Chris approves" is unworkable if approval requires remembering to open the app |
| **Background Sync** | Service worker (F1). `sync` for one-shot, `periodicsync` for recurring. Chromium only — iOS will not support it, so it is an enhancement over F4, never a replacement | The outbox is observed to sit unsynced because the app is never reopened |
| **Share target** | `share_target` in the manifest (Android). On iOS, handle `?text=` on load plus a user-installed Shortcut | Captures are observed to be lost because opening the app was too much friction at the moment of the thought. This is the likeliest of the four to be earned |
| **Audio capture** | Storage, a speech-to-text provider, format handling. Already cut once in `docs/spec.md` §1 | iOS keyboard dictation is observed to be insufficient |

One design constraint follows from this table and should be honoured now: **the
service worker added in F1 must be structured so that push and sync handlers
can be added to it without restructuring.** Use `injectManifest` rather than
`generateSW` if that proves cleaner — the extra control is worth more than the
saved boilerplate given three of the four items above are service worker event
handlers.

---

## 5. Definition of done for this spec

All P0 and P1 features meet their acceptance criteria, and:

1. The installed app on a real iPhone, in aeroplane mode, cold-launched from
   the home screen, accepts a capture and shows the existing inbox.
2. Restoring connectivity syncs that capture and it reaches `done`.
3. Every claim in `README.md` is true. Where a claim cannot be made true, the
   claim is edited rather than left standing.
4. The e2e suite covers the offline round-trip and runs against WebKit in CI.
5. A stuck capture raises an alert rather than waiting to be discovered.

Point 3 is not a formality. The gap between what this repo's documentation says
and what it does is what produced this spec.
