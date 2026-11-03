# Attention queue — build tickets

Tracer-bullet tickets for `docs/arc-spec-attention-queue.md` (the "Needs you"
middle layer), plus the two hardening items folded in by decision:
**F9 realtime resilience** and **F10 sign-out** from `docs/arc-spec-pwa-hardening.md`.

Produced by `to-tickets` (Reeve fork) on 2026-07-31 after four decisions were
taken with Chris. Each ticket is a **vertical slice** — a narrow but complete
path through every layer it touches — with its **blocking edges** as text.

## Decisions this graph encodes

| Decision | Choice | Consequence in the tickets |
|---|---|---|
| Scope | Queue (AQ-1…6) + bugs (B-1, B-2) + F9 + F10 | F11, WP-F4.3, Stage 6 are **not** here |
| What's "actionable" | **Broader** — anything that reads as intent-to-do | T-AQ2p: the triage model judges actionability and drafts the action |
| Action ↔ commitment | **Coexist** — each its own lens | No coupling; Due is unchanged; action only *references* its capture |
| "Go" dispatch (v1) | **Reuse the change-request path** for `reeve`; copy-brief elsewhere | T-AQ4 lifts P1-F8's on-demand brief; no new dispatch infra |

## Corrections carried from the codebase (verified 2026-07-31)

- **Migration number is `0014`, not the spec's `0013`.** `0013_loop_metrics.sql`
  is applied. Run `pnpm db:status` before naming it anyway — this is the exact
  "specs name numbers that were free when written" trap in `CLAUDE.md`.
- **A new `actions` write path needs four touch-points**, not one: the outbox
  (`apps/web/src/lib/outbox.ts` — new op kind + `send()` branch + a
  `pendingActionPatch` overlay, mirroring the commitment branch), the persist
  allow-list (`apps/web/src/lib/query.ts` `shouldPersistQuery`), the realtime
  channel, and test teardown (`tests/support/test-accounts.ts` `purgeTestData`
  — or let it cascade from `captures`).
- **F9 now spans four channels**, not two: `captures` (`Inbox.tsx`),
  `commitments` (`Due.tsx`), `change_requests` (`ReeveChangeRequests.tsx`), and
  the new `actions` channel. Build the shared hook first so the queue is built
  on it (T-F9 → T-AQ2s).
- **The nav is a state switch, not a router** (`apps/web/src/App.tsx`: `Screen`
  union, `NAV` const, the screen `switch`). Adding/replacing a tab is those
  three edits plus a screen file.
- **A settings sheet already exists** behind an icon in the Due header
  (`components/Settings.tsx`) — the home for F10 sign-out.

---

## The graph

```
  T-B (bugs) ──────────────────────────────── independent, ship first
  T-F10 (sign-out) ────────────────────────── independent
  T-F9 (realtime hook) ──────────┐
  T-AQ1 (schema) ──┬── T-AQ6 (Search) ──┐
                   └── T-AQ2p (producer) ─┴─ T-AQ2s (stream) ──┬── T-AQ3 (order)
                                    (+ T-F9)                    ├── T-AQ4 (Go) ── T-AQ5 (result loop)
                                                                └───────────────┘
```

Critical path: **AQ1 → AQ2p → AQ2s → AQ4 → AQ5**, with **AQ6** and **F9** also
gating AQ2s. Off the path: **T-B**, **T-F10**. Frontier (grabbable now):
**T-B, T-F9, T-F10, T-AQ1**.

**Ship discipline (`CLAUDE.md`).** The tests and migrations share **one live
free-tier Supabase project**; even the two CI jobs can't run against it at once.
So coding can fan out into worktrees, but **migrations, the live-backend test
suite, and pushes ship one at a time** — CI is `cancel-in-progress`. Pure-CSS
tickets (T-B) touch no backend and are the only safely-concurrent ones.

---

# T-B — The two bugs

**What to build:** the installed PWA's bottom nav sits flush to the bottom (no
empty strip), and mobile type is a size smaller by default, restored at `sm:`.
Ship both in one commit — they're the "ship first" pair and one CI run is
cheaper than two.

- **B-1** (`apps/web/src/styles.css` ~101–105): `#root { height: 100dvh }` with
  `100%` as the fallback, tracking the `viewport-fit=cover` standalone viewport;
  convert any stray `100vh` / `h-screen`. **Cannot be reproduced in the harness**
  (Playwright is Chromium; the bug is iOS Safari standalone) — make the change on
  the hypothesis; **Chris verifies on a real installed PWA.**
- **B-2**: responsive type — writing surface and its departure-animation clone
  (`Capture.tsx:139` and `:116`, which **must** stay identical or the save
  animation jumps size), and screen headings (`Capture.tsx:102`, `Due.tsx:144`,
  `Inbox.tsx:129`). `!text-[1.7rem]` → `!text-[1.35rem] sm:!text-[1.7rem]`;
  headings `text-[1.75rem]` → `text-[1.45rem] sm:text-[1.75rem]`. `1.35rem`
  stays above the 16px focus-zoom floor. **Do not** change the typeface.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent · pure frontend, no backend, parallel-safe

- [ ] Installed-PWA nav change made on the B-1 hypothesis; verified by Chris on device
- [ ] Type scales down on mobile and is unchanged at `sm:`; the animation clone matches the textarea exactly
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean (no live-backend suite needed)

---

# T-F9 — Realtime resilience as a shared hook

**What to build:** one shared realtime helper that survives a backgrounded PWA,
and convert the three existing ad-hoc subscriptions to it — so the new `actions`
channel (T-AQ2s) inherits the fix instead of repeating the bug a fourth time.

The helper handles: re-subscribe on `visibilitychange` when visible (and close
the gap by refreshing the query at the same time); `CHANNEL_ERROR` / `TIMED_OUT`
from `.subscribe()` with bounded backoff (the status arg is ignored today); a
`filter: user_id=eq.<uid>` on the subscription; **apply the payload to the cache**
rather than invalidating (a capture going `queued→processing→done` triggers three
full refetches of up to 200 rows today); and teardown when backgrounded long-term.

Convert: `Inbox.tsx` (`captures-changes`), `Due.tsx` (`commitments-changes`),
`ReeveChangeRequests.tsx` (`change-requests-changes`).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent · frontend refactor; verify against live realtime

- [ ] Background the installed app ~10 min, foreground, insert a row server-side → it appears without reload
- [ ] A single capture completing triage causes no full-list refetch (payload applied to cache)
- [ ] All three existing channels use the shared helper; behaviour unchanged for the user
- [ ] The helper takes a per-channel table + cache-apply callback so `actions` can reuse it verbatim

---

# T-F10 — Sign-out and session lifecycle

**What to build:** a sign-out you can actually reach, and a graceful return to
sign-in when a session goes bad — the thing that makes living with owner-scoped
areas (and testing a second account) possible.

- Sign-out affordance in the existing settings sheet (`components/Settings.tsx`,
  reached from the Due header).
- Sign-out clears, in order: the persisted query cache (`purgeQueryCache()`),
  the draft key, then the Supabase session. It **must not** clear the outbox — an
  unsynced capture belongs to the device, not the session. Confirm if the outbox
  is non-empty.
- Handle refresh-token failure explicitly: a token that can't refresh after a
  long offline period returns the user to sign-in rather than failing queries
  silently.
- **Password reset (F10.4) is out of this ticket** — it's gated by the free-tier
  2-emails/hour limit and the iOS "link opens in Safari, not the PWA" problem;
  defer until the recovery path is actually needed.

**Blocked by:** None — can start immediately (F2 persisted cache already exists).

**Status:** ready-for-agent · frontend + auth; tests sign in live

- [ ] Sign out, sign in as a second account → no rows/drafts/cached queries from the first are visible
- [ ] Sign out with a pending outbox item → it's still pending after signing back in as the same user
- [ ] A dead refresh token lands on sign-in, not on silent query failure

---

# T-AQ1 — Actions schema + shared `Action` type

**What to build:** the foundation the whole queue stands on — an `actions` table
carrying a capture through a decision lifecycle, and a soft-delete on captures.
Follow **`reeve-migrate`** (the gates are not optional).

- Migration **`0014_actions_and_archive.sql`** (confirm the number with
  `pnpm db:status` first): `alter table captures add column archived_at
  timestamptz`; `create type action_status as enum
  ('proposed','dispatched','review','done','declined')`; the `actions` table per
  the spec's AQ-1 DDL (**no `position` column** — priority is computed, AQ-3);
  the `actions_needs_you` partial index; RLS select/insert/update policies
  scoped to `auth.uid()` and **no delete policy** (archive, never delete); add
  `actions` to the `supabase_realtime` publication.
- `packages/shared`: `Action` schema + type and `ActionStatus`, mirroring
  `Commitment` (`schemas.ts`); parallel helpers alongside `commitments.ts` only
  if the model needs them.
- The migration is **purely additive** (new table, new nullable column) so the
  `--yes` row-rewrite gate should not trigger; if it does, stop and look.

**Blocked by:** None — can start immediately. **Root of the critical path.**

**Status:** ready-for-agent · migration; serialize against other backend work

- [ ] `pnpm db:migrate` applies `0014`; `pnpm db:status` shows it tracked
- [ ] An `actions` row can be inserted and read under RLS; a second account sees none of the first's (extend `rls.test.ts`)
- [ ] Attempting a client `delete` on `actions` is refused (no policy)
- [ ] `Action` / `ActionStatus` exported from `@reeve/shared` and typecheck-clean

---

# T-AQ6 — Search (where the retired Inbox's history lives)

**What to build:** a lightweight all-captures view — a search field over
`raw_text`/`title` and a reverse-chronological list, archived items included,
off the primary nav — and the **archive** gesture that sets `archived_at`. This
**must exist before T-AQ2s retires the Inbox**, or losing the chronological list
feels like data loss; if it slips, keep the old Inbox reachable behind an icon
until it lands.

- Archiving is an `UPDATE` to `captures.archived_at`, already permitted by
  `captures_update`. It needs a **capture-update outbox op** — the outbox has no
  capture-update path today (only insert), so add one mirroring the commitment
  patch branch. Archiving must be reversible.
- Add the Search query key to `shouldPersistQuery` in `query.ts` if it should
  read offline.

**Blocked by:** T-AQ1 (needs `archived_at`).

**Status:** ready-for-agent · frontend + light backend

- [ ] Any past capture, archived or not, is findable without the old Inbox
- [ ] Archiving hides a capture from Search's default view and is reversible (Undo)
- [ ] The archive write survives offline via the outbox

---

# T-AQ2p — Triage produces proposed actions (the "Broader" line)

**What to build:** triage learns to judge whether a capture is actionable and,
when it is, to draft the proposed action — so an actionable capture lands in the
queue as a `proposed` action. **Broader**, per decision: anything that reads as
intent-to-do is actionable, not only clear commitments. We watch the queue for
noise and tighten later.

- Extend the triage output contract (`packages/shared/src/triage-prompt.ts`,
  `TRIAGE_JSON_SCHEMA`) with an actionability judgment + a proposed `title` and
  `brief`; teach the prompt the Broader line with examples of the note/action
  boundary.
- In the `triage` Edge Function, when actionable, **insert an `actions` row**
  (`status='proposed'`, `capture_id`, `area_id`, `title`, `brief`) alongside the
  existing filing. Re-triage must not duplicate the action (idempotency, the way
  commitments dedupe by fingerprint).
- Deploy `triage` after the change (`supabase functions deploy triage`).
- **Give any triaging test account its own areas** — never the owner's real
  taxonomy (the P1-F0 exposure). Seed an `unsorted` too.

**Blocked by:** T-AQ1 (the `actions` table).

**Status:** ready-for-agent · backend/function; serialize; needs a deploy

- [ ] An actionable capture produces exactly one `proposed` action; re-triage adds none
- [ ] A plain-reference capture produces no action
- [ ] The action carries a usable `title`/`brief` and the capture's `area_id`
- [ ] `triage.test.ts` covers actionable and non-actionable, against a test taxonomy

---

# T-AQ2s — The "Needs you" stream (replaces the Inbox tab)

**What to build:** the middle of the app becomes a stream of decisions. A
proposed action shows Reeve's read of the capture with **Go / Tweak / Just a
note**; deciding removes it; **Undo** restores it. The Inbox tab is retired for
**Needs you**.

- New `apps/web/src/screens/NeedsYou.tsx`; reuse the detail sheet
  (`CaptureDetail`/`ResponsiveSheet`). Membership: `actions` where `archived_at
  is null and status in ('proposed','review')`, realtime-subscribed **via the
  T-F9 shared hook** (the `actions` channel). Pending/failed *captures* still
  surface at the top until they finish triaging, as today.
- Decisions write through the **outbox** (new action op kind + `send()` branch +
  `pendingActionPatch` overlay in `outbox.ts`): **Go** → `dispatched` (the
  handoff itself is T-AQ4); **Tweak** → edit `title`/`brief` (this is also the
  capture's own title/summary edit — raw text stays immutable); **Just a note**
  → `declined`, with an Undo toast.
- Nav: `App.tsx` `Screen` union / `NAV` / switch — **Write · Needs you · Due**;
  the in-flight dot moves to the Needs you icon. Add the actions query key to
  `shouldPersistQuery`. Empty state: "You're all caught up." Keep the old Inbox
  reachable behind an icon as the safety net until Search (T-AQ6) is proven.
- Carry the B-2 responsive heading classes into the new header.
- `purgeTestData` gains an `actions` teardown (unless it cascades from captures).

**Blocked by:** T-AQ1 (schema), T-AQ2p (there are actions to show), T-AQ6
(Search exists before the Inbox retires), T-F9 (the shared realtime hook).

**Status:** ready-for-agent · frontend; the largest slice

- [ ] An actionable capture appears as a proposed action, AI-read shown
- [ ] Go / Tweak / Just-a-note each removes it from the stream; Undo restores it
- [ ] Editing title/brief persists (offline-capable via the outbox); raw text is never editable
- [ ] The stream reaches zero and shows the caught-up empty state
- [ ] Decisions taken on another device leave the stream in realtime

---

# T-AQ3 — AI-proposed order + the "Do next" pin

**What to build:** the stream orders itself so the top item is the right next
decision, with one manual lever. **v1, computed:** pinned (`pinned_at`, newest
first) → linked commitment's due date (overdue → soonest → none) → recency. A
single **"Do next"** sets `pinned_at`. **No drag handles anywhere.**

- Put the ordering behind a **single call site** so the v2 model-scored order can
  swap in without touching the UI. Do **not** build v2 scoring now.

**Blocked by:** T-AQ2s.

**Status:** ready-for-agent · frontend + light backend

- [ ] Overdue and pinned items lead; pinning re-orders instantly and survives reload
- [ ] Ordering is one swappable function; no drag affordance exists

---

# T-AQ4 — The "Go" handoff (manual dispatch)

**What to build:** Go assembles a self-contained **handoff brief** — the action
title, the capture's `raw_text`, the area and its context, any commitment/date —
stores it in `actions.brief`, and sets `status='dispatched'`.

- **Reuse the change-request path** (decision): a **`reeve`-area** action routes
  through the *existing* change-request pipeline — lift the on-demand
  brief-assembly from P1-F8 (`change-request-prompt.ts` / `draft-change-request`)
  rather than forking it, so it goes issue → `@claude` → PR → webhook → shipped →
  push exactly as a `reeve` chip capture does today.
- **Every other area:** present the brief for Chris to hand to an agent
  (copy-to-clipboard / "Open in…"). No automated dispatch — automation is
  `spec.md` §9. Keep the brief shape close to what an agent session consumes so
  §9 is wiring, not redesign.

**Blocked by:** T-AQ2s.

**Status:** ready-for-agent · frontend + reuse existing functions

- [ ] Go produces a complete, self-contained brief and moves the action to `dispatched`
- [ ] A `reeve` action goes through the change-request path (issue filed, loop closes on merge)
- [ ] A non-`reeve` action yields a copyable brief; nothing is auto-dispatched

---

# T-AQ5 — The result loop (scaffold; automated return is §9)

**What to build:** the output half of "agents draft, Chris approves." A
dispatched action that gets a result re-enters Needs you as an **Approve / Redo**
decision, same visual language as a proposed action.

- Build the `review` state and its UI (`result` shown; Approve → `done`; Redo →
  back to `dispatched` with a note). The **automated** transition into `review`
  is **out of scope and flagged as such in code** — with manual dispatch there
  may be no automated return; until §9, Chris can move `dispatched → review →
  done` by hand.

**Blocked by:** T-AQ2s, T-AQ4.

**Status:** ready-for-agent · frontend

- [ ] The review UI exists and is reachable; an action can move dispatched → review → done
- [ ] The automated entry into `review` is explicitly out of scope, flagged in code
- [ ] A `reeve` action shipped via the change-request loop can be reflected as done

---

## Close-out (every ticket, per `reeve-ship`)

`pnpm typecheck && lint && test` locally (add `test:e2e` for offline/SW/flow
changes) → branch if on `main` → **push once, watch CI, confirm the deploy** →
deploy any changed Edge Function (`triage` in T-AQ2p) → update
`docs/arc-spec-attention-queue.md`'s status section (add a `## 0. Implementation
status` when the first ticket lands) and `CLAUDE.md` if a lesson was learned.
