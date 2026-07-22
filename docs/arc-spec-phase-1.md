# Reeve: Architecture Spec — Phase 1

Status: **Stages 0–3 built and deployed.** Stages 4 and 5 remain approved and
unbuilt; §0 records what blocks each. Stage 6 (§8) remains described, not
built, and approval here does not extend to it.
Owner: spec-owned. Implementation runs in separate sessions — where this
document is wrong, ambiguous or silent, raise it against the spec rather than
deciding it in the diff.
Extends: `docs/spec.md` (Phase 0)
Sibling: `docs/arc-spec-pwa-hardening.md`
Audience: implementing dev team

Feature IDs in this document are prefixed `P1-` and are numbered independently
of the PWA hardening spec.

---

## 0. Implementation status

Approved 22 July 2026. **Stages 0 to 3 built and deployed the same day.**

| Stage | | Feature | Status |
|---|---|---|---|
| 0 | P0 | **P1-F0** `areas` ownership | ✅ Done |
| 1 | P0 | **P1-F1** Commitments as rows | ✅ Done |
| 1 | P0 | **P1-F2** The Due view | ✅ Done |
| 2 | P1 | **P1-F3** Corrections report | ✅ Done |
| 3 | P1 | **P1-F4** Cross-capture retrieval | ✅ Done |
| 4 | P0 | **P1-F5** Cost ceiling | ⬜ Not started |
| 4 | P1 | **P1-F6** The daily brief | ⛔ Blocked — needs Web Push |
| 5 | P0 | **P1-F7** Change requests | ⬜ Not started |
| 5 | P0 | **P1-F8** The drafting agent | ⬜ Not started |
| 5 | P0 | **P1-F9** Filing, and the handoff | ⛔ Blocked — needs a GitHub token |
| 5 | P1 | **P1-F10** Closing the loop | ⛔ Blocked — webhook secret, Web Push |
| 5 | P1 | **P1-F11** Where this lives in the UI | ⬜ Not started |
| 5 | P0 | **P1-F12** Guardrails | ⬜ Not started |
| 6 | — | Approval ledger | 🚫 Not approved. Described only |

Priorities are **within a stage**, not across the document. §10 carries the
sequencing and the reasoning behind it.

### The gates, answered

- **P1-F0.1 — sign-ups are disabled.** `disable_signup: true` on the Supabase
  project, confirmed through the Management API. The `areas` exposure was
  therefore **latent, not live**: no second account could be created to read
  the classifier hints. F0.2 to F0.5 were built anyway — the assumption stops
  being safe the moment a second account exists for any reason, and one did
  exist, as the first defect below records.
- **P1-F5** remains the gate it was. Nothing built in this round runs
  unattended, so nothing built here needed it. It must land before P1-F6 or
  P1-F8's scheduled pass, without exception.

### What blocks Stages 4 and 5

Three of these are Chris's to unblock; none can be worked around in code.

| Blocked | Needs | Who |
|---|---|---|
| P1-F6 delivery (F6.7) | Web Push: VAPID keys, and the service-worker handlers `docs/arc-spec-pwa-hardening.md` §4 defers | Chris, then a session |
| P1-F9 filing | A fine-grained GitHub PAT, single repository, `issues: write` and nothing else | Chris |
| P1-F10 webhook | A webhook signing secret | Chris |
| P1-F12.2 | Branch protection on `main` with the CI gates required | Chris |

P1-F7 (the `change_requests` schema) and P1-F8 (the drafting agent) need none
of the above and could be built before the token exists.

### Verified against the acceptance criteria

Against the live project, not a fixture:

- A capture reading *"I'll ring the foreman Thursday about the pour, and I need
  to send Mary the invoice by the end of the month"* produced two commitment
  rows: `due_text = "Thursday"` → `2026-07-23`, and `due_text = "end of the
  month"` → `2026-07-31`, both resolved against the capture's own timestamp.
- Re-invoking triage on that capture produced no duplicate row, and did not
  reset the commitment that had been marked done in between.
- `scripts/backfill-commitments.mjs` run twice produced the same row count as
  once.
- A second account reads no areas, no captures and no commitments belonging to
  the first, and cannot file into the first's areas — the last refused by the
  composite foreign key rather than by a policy.
- `retrieve_captures` returns a capture mentioning "Beaumont" when asked for
  "Beaumnt", and returns nothing when one account asks for another's rows.
- A commitment completed with the network off disappears immediately, is still
  gone after a cold reload, and reaches `done` in the database on reconnect.
  Covered by `e2e/offline.spec.ts`, Chromium only — the WebKit gap the
  hardening spec records applies here unchanged.
- 63 unit tests and 7 end-to-end tests pass. Typecheck, lint and the secret
  scan are clean.

### Where this document was wrong, ambiguous or silent

Raised here rather than decided quietly in the diff, per the header.

1. **Migration numbering.** P1-F0.2 says migration `0002`. That file exists,
   is applied, and carries a SHA checksum that `scripts/migrate.mjs` refuses to
   see change. Everything shifts by one: `0003` areas ownership, `0004`
   commitments, `0005` corrections, `0006` retrieval, `0007` the threshold
   calibration above.
2. **Per-user `unsorted` needs a composite primary key.** P1-F0.3 calls
   duplicating it "simpler than a special case" without noting that `id` was
   the primary key, so two rows could not share the slug at all. `areas` is now
   keyed on `(owner_id, id)`, and `captures.area_id` / `corrected_area_id`
   became composite foreign keys with it. That turned out to be the better half
   of the change: filing into another account's area is now refused by the
   schema rather than by a check someone could forget to write.
3. **P1-F0 does not mention the Edge Function.** `supabase/functions/triage`
   loads areas through the service-role client, which bypasses RLS entirely —
   so owner-scoping the policy would have left that query reading every
   account's hints. It filters on `owner_id` explicitly now, the same
   discipline P1-F4.4 asks for and for the same reason.
4. **Structured commitments could not stay inside `entities`.** P1-F1.4 asks
   for each commitment to carry a phrase and a resolved date; `entities` is
   also the persisted jsonb shape the capture sheet renders. Commitments moved
   to a top-level `TriageResult.commitments`, leaving `entities` a stable
   display contract of people, dates, amounts and orgs. Captures triaged
   earlier still carry the old key; nothing reads it, and the backfill lifts it.
5. **P1-F2.3 and P1-F2.4 are in tension, and F2.3 wins.** A durable outbox and
   "rollback on failure" cannot both hold: the outbox's entire purpose is that
   a write survives until it lands. Queued changes are laid over the server
   rows instead, so an unsynced completion survives a cold launch rather than
   reappearing as undone, and a change that cannot sync is surfaced rather than
   reverted. Reverting a tap made hours earlier in a field with no signal is
   the data loss the outbox exists to prevent.

### Five defects this spec did not predict

1. **The ownership backfill picked the wrong account, and cost two correction
   signals.** §2 says to add `owner_id` and move on; it does not say how
   existing rows acquire one. The migration derives it — the account with the
   most captures — which was sound reasoning against wrong data: the RLS test
   account had accumulated **24 fixture captures against the owner's 5**, so
   the eight real areas were assigned to a test account and the owner's own
   captures were unfiled by the foreign key that followed. Repaired by
   deleting the fixtures, re-seeding under the right account and re-triaging,
   but `corrected_area_id` on two captures was nulled and is **not
   recoverable** — nothing else records what the model had chosen. Two
   data points out of an evidence base that P1-F3 exists to read.
2. **Backoff was never reset when connectivity returned.** Every failed flush
   while offline widens the next attempt, so a long enough outage pushed it
   five minutes out and the queue then did nothing at the moment it finally
   could. Found by the P1-F2 offline test sitting at `open` for a full sixty
   seconds after reconnecting. `clearBackoff()` now runs on the `online` event;
   dead-lettered items are deliberately left alone.
3. **The default trigram threshold rejects this spec's own example.**
   `word_similarity('Decklan', 'Ring Declan …')` is 0.500 against a default
   cut-off of 0.6. 0.45 is the only band that admits the dictation errors and
   still rejects "decking" at 0.429; migration `0007` carries the measurements.
4. **Setting that threshold needs the extension loaded first.** Until pg_trgm's
   library loads, `pg_trgm.word_similarity_threshold` is an unrecognised custom
   GUC, and setting one of those requires superuser — which Supabase's
   `postgres` role is not. A `select word_similarity(…)` ahead of the
   `create function` is the whole fix, and the failure it prevents reads as a
   permissions problem rather than a loading one.
5. **Both test suites were reading the owner's real taxonomy.** The RLS and
   end-to-end accounts had no areas of their own, so triage classified their
   fixtures against the eight real `classifier_hint`s — which is precisely the
   exposure P1-F0 closes, running on every CI run. Both suites now seed their
   own invented taxonomy, and the RLS suite deletes its captures afterwards:
   they were being triaged at real cost, and accumulating.

### Gaps left open

- **Trigram retrieval is orthographic, not phonetic.** "Shivaun" scores 0.125
  against "Siobhan" — no shared trigrams, no shared lexeme, so neither half of
  P1-F4 finds it. This is the P1-F4.2 observation category. Record misses of
  this shape; they are what earns `pgvector`.
- **Nothing reads `agent_runs.cost_usd` yet.** P1-F5 is untouched, so the
  spend is still uncapped and unwatched. It is not urgent while every model
  call is user-triggered, and it is a hard prerequisite the moment one is not.
- **Re-filing a capture updates its commitments' area, but a commitment's own
  area cannot be changed.** Changing it independently of its capture is not
  possible in the UI, which seems right — the commitment belongs to the note
  it came from — but it has not been used enough to be sure.
- **The bundle is still one chunk**, and the `useInfiniteQuery` pagination the
  hardening spec's F11 asks for still does not exist. The Due view fetches 200
  rows the same way the Inbox does.

---

## 1. Why this exists

`docs/spec.md` §11 asks the question that decides Phase 1:

> What is the first thing you find yourself wanting the system to *do* with a
> capture? That answer, not this spec, decides what agent gets built after
> triage.

This document argues that the question has a structural answer underneath
whatever the intuitive one turns out to be, and that the structural answer
should be built first.

### The observation

Reeve is a filing cabinet. A capture arrives, is labelled, and becomes inert.

Nothing in the system has a notion of *owing* — that something was promised, to
someone, by a date, and is or is not done. `captures.status` does not express
this: it describes whether the machine finished processing, not whether the
thing itself is finished. A capture reaches `done` the moment it is filed, and
a filed obligation is not a discharged one.

Every plausible Phase 1 — draft that email, chase that quote, remind me about
the pour, brief me on the club — requires a capture to have a lifecycle beyond
`status`. They all need the same substrate. Three quarters of that substrate is
cheap to build now and expensive to retrofit once several thousand captures
exist.

### What this spec commits to, and what it does not

It commits to building **state**, not intelligence. Stages 1 to 3 add no new
model capability whatsoever — they make the output triage already produces
usable. Stage 4 introduces the first new agent, deliberately chosen to be one
that cannot do harm. Stage 5 introduces the first agent that *can* act, chosen
because its approval gate already exists and is mature. Stage 6 is described
but explicitly not built.

The governing principle from `docs/spec.md` §1 holds throughout: **features are
earned by observed need, not anticipated need.** §7 of this document lists what
is being deliberately left out and states the observation that would earn each
one.

### Relationship to the hardening spec

`docs/arc-spec-pwa-hardening.md` makes Phase 0's existing claims true. It is a
prerequisite for parts of this document but not for all of it:

| This spec | Depends on |
|---|---|
| Stage 1 (ledger) | Hardening F3, F4 — a Due view that mutates state needs the durable-write path to work |
| Stage 2 (taxonomy) | Nothing |
| Stage 3 (retrieval) | Nothing |
| Stage 4 (brief) | Hardening F1 and §4 Web Push — delivery is the point, and a brief nobody is told about is a brief nobody reads |
| Stage 5 (Reeve changes Reeve) | Hardening F4 for the decision path, F8's CI gates for the safety path. Substantially independent of Stages 1–4 |
| Stage 6 | Everything, plus §6 of this document |

Stage 0 below depends on nothing and should not wait for either document.

---

## 2. Stage 0 — do this now

### P1-F0 — `areas` ownership

**Priority:** P0 · **This is not a Phase 1 feature.** It appears here because
Phase 1 is where the assumption behind it stops being safe.

`supabase/migrations/0001_phase0.sql` creates `areas` with no `user_id` and the
policy:

```sql
create policy areas_read on areas
  for select to authenticated using (true);
```

Every authenticated account reads every `classifier_hint` — one or two
sentences each describing the owner's business, football club, charity and
family admin. `README.md` gitignores `supabase/seed/areas.json` on the explicit
grounds that those descriptions are personal. The application then serves them
to anyone who can obtain a session.

Whether this is currently exposed depends on whether sign-ups are open on the
Supabase project. That should be checked today regardless of what is decided
below.

`captures` and `agent_runs` already have correct owner-scoped policies —
`areas` is the one table that does not. `docs/spec.md` §11 leaves open whether
the system stays single-user; this is the decision that question actually
controls.

#### Requirements

- **P1-F0.1** Confirm whether new sign-ups are enabled on the Supabase project.
  If they are and they need not be, disable them today. This is a
  configuration change and is independent of everything below.
- **P1-F0.2** Add `owner_id uuid references auth.users(id)` to `areas`, in
  migration `0002`.
- **P1-F0.3** Replace `areas_read` with an owner-scoped policy. Retain a shared
  read path only for genuinely global rows if any are introduced; `unsorted` is
  the only candidate and duplicating it per user is simpler than a special
  case.
- **P1-F0.4** Update `scripts/seed-areas.mjs` to require an owner and refuse to
  seed without one.
- **P1-F0.5** Extend `tests/rls.test.ts` with the case it currently lacks: Bob
  cannot read Alice's areas. The existing suite covers `captures` and
  `agent_runs` properly and is the right place for this.

#### Acceptance criteria

- A second authenticated account sees no areas belonging to the first, and the
  inbox for that account renders without error.
- `tests/rls.test.ts` fails if the policy is reverted.

---

## 3. Stage 1 — the obligation ledger

The highest-value work in this document, and it requires no new model
capability.

### P1-F1 — Commitments as first-class rows

**Priority:** P0 · **Depends on:** P1-F0

`entities.commitments` is a `text[]` inside a `jsonb` column. It is the only
extraction that implies an action — `CaptureDetail.tsx` says exactly that, and
orders it first for exactly that reason.

As jsonb it cannot be queried by due date, sorted, completed, counted, or
joined. *"What did I say I would do this week?"* currently requires fetching
every capture and reducing in JavaScript. The single most valuable thing the
model extracts is stored in the least usable available shape.

#### Schema — migration `0003_commitments.sql`

```sql
create type commitment_status as enum ('open', 'done', 'dropped');

create table commitments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  capture_id   uuid not null references captures(id) on delete cascade,
  area_id      text references areas(id),
  text         text not null,
  -- The verbatim date phrase as captured ("next Tuesday", "end of the month")
  -- alongside the resolved timestamp. Keeping both follows the same reasoning
  -- as corrected_area_id: never destroy the original signal in favour of the
  -- machine's interpretation of it.
  due_text     text,
  due_at       timestamptz,
  status       commitment_status not null default 'open',
  completed_at timestamptz,
  origin       text not null default 'model' check (origin in ('model','user')),
  -- Stable hash of (capture_id, normalised text). Makes re-triage idempotent.
  fingerprint  text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index commitments_fingerprint on commitments (fingerprint);
create index commitments_due on commitments (user_id, status, due_at);
create index commitments_by_capture on commitments (capture_id);
```

#### Requirements

- **P1-F1.1** RLS on `commitments`, owner-scoped for select, insert and update,
  matching the existing `captures` policies. Deletion is not permitted — a
  dropped commitment moves to `status = 'dropped'`. The reasoning in
  `docs/spec.md` about never losing a capture applies with equal force to a
  thing the user said they would do.
- **P1-F1.2** The triage Edge Function writes commitment rows alongside the
  capture update, in the same logical step. A capture reaching `done` with
  commitments still trapped only in jsonb is a partial write.
- **P1-F1.3** Writes must be idempotent under re-triage. Upsert on
  `fingerprint`. Never delete and reinsert: a row the user has completed or
  edited must survive a re-run of the model. This matters because
  hardening F5 introduces a sweeper that will legitimately re-invoke triage.
- **P1-F1.4** **The triage prompt must be given a reference date.**
  `packages/shared/src/triage-prompt.ts` currently instructs the model to
  extract dates "verbatim as written" and gives it no notion of when *now* is.
  "Thursday" is therefore unresolvable. Inject the capture's `created_at` and
  the `Europe/Dublin` timezone into the system prompt, and extend
  `TriageResult` so each commitment carries both the verbatim phrase and a
  resolved ISO date where one can be determined.
- **P1-F1.5** An unresolvable date is not a failure. A commitment with
  `due_at IS NULL` and a populated `due_text` is valid and must be surfaced,
  not discarded — the same principle that routes an unplaceable capture to
  `unsorted` rather than failing it.
- **P1-F1.6** Backfill script for existing captures, at
  `scripts/backfill-commitments.mjs`. Idempotent, re-runnable, dry-run by
  default. This is a one-off script today and an archaeology project in six
  months.
- **P1-F1.7** Add `commitments` to the `supabase_realtime` publication, so the
  Due view updates in place the way the inbox does.
- **P1-F1.8** Extend `TriageResult` in `packages/shared/src/schemas.ts` and keep
  `tests/triage.test.ts`'s closed-schema assertions passing. Structured outputs
  requires `required` on every property and `additionalProperties: false`; that
  test exists to catch drift and must not be relaxed.

#### Acceptance criteria

- A capture containing "I'll ring the foreman Thursday about the pour" produces
  one commitment row with `due_text = "Thursday"` and `due_at` resolved to the
  correct date relative to the capture's own timestamp.
- Re-invoking triage on that capture produces no duplicate row, and does not
  reset a commitment the user has already marked done.
- The backfill run twice produces the same row count as running it once.

### P1-F2 — The Due view

**Priority:** P0 · **Depends on:** P1-F1, hardening F3 and F4

A third screen alongside Capture and Inbox. This is the change that turns Reeve
from something written *into* to something looked *at*, which is what will
generate the usage that earns everything after it.

#### Requirements

- **P1-F2.1** Group by urgency, not by area: *Overdue*, *Today*, *This week*,
  *Later*, *No date*. Area remains the colour signal per `docs/spec.md` §7, but
  it is not the primary axis here — time is.
- **P1-F2.2** Complete and drop, both reachable one-handed. Both are updates,
  never deletes.
- **P1-F2.3** Every mutation goes through the same durable, offline-tolerant
  path as capture. Reuse the outbox from hardening F4 rather than writing a
  second sync mechanism — a second one will diverge.
- **P1-F2.4** Optimistic updates with rollback on failure. Marking something
  done must feel instant; the network is still not a given.
- **P1-F2.5** Each commitment links back to its source capture. The raw text is
  the context, and a commitment read without it is frequently ambiguous.
- **P1-F2.6** Editing a commitment's text or due date sets `origin = 'user'`.
  As with `corrected_area_id`, the divergence between what the model extracted
  and what the user meant is evidence about extraction quality — preserve it.
- **P1-F2.7** The empty state is a real state, not an error. No open
  commitments is a good outcome and should read as one.

#### Acceptance criteria

- Marking a commitment done offline updates the UI immediately, persists across
  a cold reload, and syncs on reconnect.
- A commitment with no resolvable due date is visible and actionable.
- Every commitment reaches its source capture in one tap.

---

## 4. Stage 2 — close the taxonomy loop

### P1-F3 — Corrections report

**Priority:** P1 · **Depends on:** nothing · **Effort:** small

`corrected_area_id` is the best idea in the existing codebase. Refiling as
signal rather than correction is exactly right, and the comment in
`CaptureDetail.tsx` explaining why is worth keeping verbatim.

It is written by the client and **read by nothing.** There is no view, no
query, no report. The signal accumulates in a column that no code path
consults.

Meanwhile `README.md` states that `classifier_hint` is "the single biggest
lever on classification quality." The corrections column is the only evidence
about which hint is wrong. Connecting the two is perhaps an hour of work and
converts a quality intuition into a quality metric.

#### Requirements

- **P1-F3.1** A SQL view `triage_corrections` exposing, per (predicted,
  corrected) area pair: count, most recent occurrence, and sample capture ids.
- **P1-F3.2** A second view for the two headline rates: correction rate and
  `unsorted` rate, bucketed by week. A rising `unsorted` rate means the
  taxonomy has a gap; a rising correction rate concentrated on one pair means a
  specific hint is wrong. These are different problems with different fixes.
- **P1-F3.3** Delivery is a script — `pnpm triage:report` — printing to the
  terminal. **Not a screen.** A screen for this is a feature to be earned, and
  the thing that would earn it is finding yourself running the script weekly.
- **P1-F3.4** The report must name the specific `classifier_hint` text for both
  areas in each confused pair, so the fix is visible in the output rather than
  requiring a second lookup.

#### Acceptance criteria

- After a fortnight of real use, the report answers "which hint should I edit
  first" in under a minute, without further querying.

---

## 5. Stage 3 — retrieval substrate

### P1-F4 — Cross-capture retrieval

**Priority:** P1 · **Depends on:** nothing · **Blocks:** Stage 4

Triage classifies each note in perfect isolation: one call, one note, no
knowledge that four hundred others exist. That is correct for classification
and useless for everything after it.

Every interesting Phase 1 operation spans captures — *what is outstanding on
the Homeown.ie build*, *did I ever follow up with him*, *these six notes are the
same job*. All of them need a retrieval step before the model call.

#### Requirements

- **P1-F4.1** **Start with Postgres full-text search, not embeddings.** Add a
  `tsvector` column over `raw_text`, `title` and `summary`, with a GIN index
  and `pg_trgm` for fuzzy name matching. At the current corpus size this is
  likely sufficient, costs nothing per query, and introduces no second vendor.
- **P1-F4.2** Only adopt `pgvector` when FTS demonstrably fails — specifically,
  when a retrieval that should have found a capture does not, because the
  wording differs from the query. Record those misses; they are the observation
  that earns the upgrade. Note that Anthropic does not provide an embeddings
  API, so this decision adds a vendor.
- **P1-F4.3** Retrieval is a single documented function with one signature,
  used by every downstream consumer. Two call sites building context two
  different ways is how agent quality becomes unexplainable.
- **P1-F4.4** Retrieval must be scoped by `user_id` at the query level, not
  relied upon via RLS alone, since it will be called from the Edge Function's
  secret-key client. This is the same discipline already applied in
  `supabase/functions/triage/index.ts`.
- **P1-F4.5** Do **not** introduce a thread, project or grouping concept.
  Semantic and lexical similarity first; explicit grouping is deferred to §7.

#### Acceptance criteria

- A query for a person's name returns every capture mentioning them, including
  ones where dictation garbled the spelling.
- Retrieval never returns a row belonging to another user, verified by test.

---

## 6. Stage 4 — the first agent

### P1-F5 — Cost ceiling

**Priority:** P0 for this stage · **Must land before anything runs on a
schedule**

`agent_runs` records `cost_usd` per call, correctly, with a deliberate `null`
for unpriced models. Nothing reads it.

At Haiku prices and one call per capture that is fine. On a schedule, at Sonnet
or above, a loop that retries pathologically is a genuinely expensive night.
The instrumentation is already built; it needs a consumer and a limit.

#### Requirements

- **P1-F5.1** A daily and monthly spend view over `agent_runs`.
- **P1-F5.2** A hard budget check inside every scheduled function. If the
  rolling spend exceeds a configured ceiling, the function refuses to make the
  model call, logs an `agent_runs` row with `ok = false`, and alerts. Refusing
  is the correct behaviour: this system's job is capture and drafting, and
  neither is worth an unbounded bill.
- **P1-F5.3** Extend `PRICING` in `packages/shared/src/models.ts` as tiers are
  added, and keep the `null`-for-unpriced behaviour — a null is a visible
  prompt to add pricing, whereas a guess silently corrupts the spend history.

### P1-F6 — The daily brief

**Priority:** P1 · **Depends on:** P1-F1, P1-F4, P1-F5, hardening F1 + Web Push

The first new agent. It is chosen deliberately for what it **cannot** do.

It has no tools, no sandbox, no credentials, no ability to write anywhere
except its own table, and no contact with the outside world. It exercises the
entire substrate — retrieval, model tiering, cost logging, scheduling,
delivery — while the worst possible failure is a badly written paragraph.

That risk profile is the point. The first thing deployed on a schedule should
not also be the first thing capable of causing harm.

#### This does not justify adopting Managed Agents

`docs/spec.md` §9 states that Managed Agents arrives with the first agent that
genuinely requires it — tools, a sandbox, files, or an approval gate. A single
Sonnet call over retrieved context requires none of those. A scheduled Edge
Function is the honest answer here, and adopting a beta agent platform to run
one prompt would be exactly the anticipation the governing principle warns
against.

Stage 5 is where that decision is genuinely live.

#### Requirements

- **P1-F6.1** Schema: a `briefs` table — `id`, `user_id`, `period_start`,
  `period_end`, `body`, `model`, `created_at`. Owner-scoped RLS. Never deleted.
- **P1-F6.2** Scheduled via `pg_cron`, at a configurable time. Default to
  early morning local time.
- **P1-F6.3** Context assembled from: commitments due or overdue in the window,
  captures created in the window, and the current `unsorted` pile. Assembled by
  the P1-F4.3 retrieval function, not by bespoke queries.
- **P1-F6.4** Model: `claude-sonnet-5` per the tiering table in
  `packages/shared/src/models.ts`. Drafting is the documented use for that
  tier. Add `brief` to the `MODELS` map rather than hardcoding.
- **P1-F6.5** Structured output, Zod-validated at the boundary, consistent with
  how triage is written. Guard `stop_reason` for `refusal` and `max_tokens`
  before reading content — the existing triage function does this correctly and
  is the reference implementation.
- **P1-F6.6** Log to `agent_runs` with `step = 'brief'` on every attempt,
  success or failure. The table was designed for exactly this and needs no
  change.
- **P1-F6.7** Delivered by Web Push. A brief that requires remembering to open
  the app will not be read, and the whole value is that it arrives.
- **P1-F6.8** A brief that fails to generate is silent — no push, no error
  toast. Failure is visible in `agent_runs` and to the hardening F7 alerting,
  not to the user at seven in the morning.

#### Acceptance criteria

- A brief generates on schedule, references real open commitments by name, and
  arrives as a push notification on the installed app.
- Its cost appears in `agent_runs` and in the spend view.
- Forcing the budget ceiling to zero prevents the model call entirely and
  produces an alert.

#### The latency contract changes here

Phase 0's contract is fifteen seconds and synchronous-feeling: you watch the
row move from `queued` to `done`. Everything from Stage 4 onward is
asynchronous and long-running. The contract becomes *"it will be there later,
and you will be told."*

That is a product change as much as a technical one, and it is the concrete
reason Web Push is a Phase 1 dependency rather than a nicety.

---

## 7. Stage 5 — Reeve changes Reeve

The first agent that acts on the outside world.

The `reeve` area already exists in the seeded taxonomy, so thoughts about the
app are already being captured and filed. They currently go nowhere. Acting on
one means being at a desk, remembering the thought, and describing it again to
a coding agent — which is precisely the friction Reeve was built to remove, for
every subject except itself.

This stage closes that loop: a thought about the app, dictated in a car,
becomes a reviewed change in the repository.

### Why this comes before the general approval ledger

§8 argues that an acting agent needs a durable approval gate, and that building
one is substantial work. That argument stands for every action *except this
one*, because this one's gate already exists:

| §8 requires | Provided here by |
|---|---|
| A durable proposal that survives the agent dying | A GitHub issue |
| An approval step that can be answered hours later, from anywhere | Pull request review, in the GitHub mobile app |
| An executor separate from the proposer, with its own retries | GitHub Actions — `deploy.yml` already exists and already works |
| A policy engine constraining what can be executed | Branch protection plus the CI gates from hardening F8 |
| An audit trail | Git history, which is the best one in the building |
| Reversibility | `git revert` |

Nothing in this stage needs §8's `proposals` table, because for this action
type GitHub *is* the proposals table. It is also a gate that has been reviewed
by more people than anything this project will ever build.

That makes this a better first acting agent than the Stage 4 brief in one
important respect: the brief is safe because it is inert. This is safe because
its blast radius is contained by a mature mechanism — which is a stronger
property, and the one that generalises.

### Why it is worth doing early

Stage 5 is a force multiplier on the rest of this document. Every subsequent
item — every observation that earns a feature in §9, every defect found in
daily use — gets cheaper to record and act on. The system that makes the system
easier to change should not be last in the queue.

It is also substantially independent of Stages 1 to 4. It wants P1-F4's
retrieval for clustering and P1-F5's cost ceiling before anything runs on a
schedule, but a first version needs neither.

### The honest risk, stated up front

**The most seductive failure mode available to this project is that Reeve
becomes a tool for building Reeve, and nothing else.**

The system exists to serve contracting, Homeown.ie, the club, the charity, the
day job and personal admin. A self-improvement loop is more immediately
gratifying than any of those, and it is infinitely extensible. See P1-F10.5 for
the metric that detects this happening, and treat a rising `reeve` share of
captures as a warning rather than as engagement.

---

### P1-F7 — Change requests

**Priority:** P0 for this stage · **Depends on:** hardening F4

A change request is one or more captures, promoted deliberately, drafted into
something a developer or coding agent can act on.

The many-to-one shape matters. "The inbox feels cramped", "the date should be
bigger" and "why is the word count still there" captured across three days are
one ticket, not three. Filing them separately produces noise that has to be
reconciled by hand — which is the work this stage exists to remove.

#### Schema — migration `0004_change_requests.sql`

```sql
create type change_request_status as enum (
  'draft',        -- captures gathered, nothing drafted yet
  'proposed',     -- an agent has written a body; awaiting Chris
  'rejected',     -- declined. Never deleted, and never re-proposed
  'filed',        -- an issue exists on GitHub
  'in_progress',  -- a pull request is open
  'shipped',      -- merged and deployed
  'abandoned'     -- closed without merging
);

create table change_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  body         text,                       -- markdown, house spec style
  questions    text[] not null default '{}',  -- ambiguities the agent would not resolve
  status       change_request_status not null default 'draft',
  -- Outbound identity. Null until filed.
  issue_number int,
  issue_url    text,
  pr_number    int,
  pr_url       text,
  -- Idempotency for the filing step. An approval acted on twice must not
  -- create two issues. Same principle as §8's execution_key.
  filing_key   text unique not null default gen_random_uuid()::text,
  decided_at   timestamptz,
  filed_at     timestamptz,
  shipped_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table change_request_captures (
  change_request_id uuid not null references change_requests(id) on delete cascade,
  capture_id        uuid not null references captures(id) on delete cascade,
  primary key (change_request_id, capture_id)
);

create index change_requests_open on change_requests (user_id, status, created_at desc);
```

#### Requirements

- **P1-F7.1** Owner-scoped RLS on both tables, matching the existing `captures`
  policies. No delete policy. A rejected idea is kept, for the same reason
  `corrected_area_id` is kept: the record of what was declined is evidence.
- **P1-F7.2** **A capture is never filed automatically.** Landing in the `reeve`
  area makes a capture *eligible*, nothing more. `docs/spec.md` §9's hard rule —
  no unattended write to the outside world without an explicit confirm step —
  applies to creating an issue, not only to merging code.
- **P1-F7.3** Rejected change requests are excluded from future clustering, and
  their source captures are marked as considered. Without this the weekly
  drafting pass re-proposes the same declined idea indefinitely, and the review
  step becomes something to skip.
- **P1-F7.4** A capture may belong to at most one non-rejected change request.
  Enforce it, so the same thought cannot be filed twice through two clusters.
- **P1-F7.5** Every state transition goes through the hardening F4 outbox, like
  every other mutation in the app. Reviewing and deciding must work with no
  signal; only the *filing* needs the network, and that happens server-side when
  the decision syncs. Do not write a second sync mechanism.

#### Acceptance criteria

- Three captures about the same UI defect can be promoted into one change
  request.
- A change request approved while offline files exactly one issue when
  connectivity returns, and files exactly one if the decision syncs twice.
- A rejected request never reappears in a later drafting pass.

---

### P1-F8 — The drafting agent

**Priority:** P0 for this stage · **Depends on:** P1-F7, P1-F5 (ceiling)

Turns fragmentary dictated notes into something worth handing to a developer.

#### Requirements

- **P1-F8.1** Two triggers: on demand ("draft a change from these captures"),
  and a weekly scheduled pass that clusters the unpromoted `reeve` pile. The
  scheduled pass produces `draft` rows only — it never advances to `proposed`
  without being read.
- **P1-F8.2** Model: `claude-sonnet-5`. Drafting is the documented use for that
  tier in `packages/shared/src/models.ts`. Add `change_request` to the `MODELS`
  map rather than hardcoding.
- **P1-F8.3** Structured output, Zod-validated, `stop_reason` guarded for
  `refusal` and `max_tokens` before reading content. The triage function is the
  reference implementation and this should read like it.
- **P1-F8.4** Output shape: `title`, `body` (markdown), `acceptance_criteria`,
  `files_likely_touched`, `size` (one of small / medium / large), and
  `questions`.
- **P1-F8.5** **The agent must not resolve ambiguity by inventing
  requirements.** A dictated fragment frequently does not contain enough to
  specify a change. Anything the agent had to guess goes in `questions` and is
  surfaced in review. A confidently-specified wrong thing is worse than an
  obviously incomplete one, because the first gets built.
- **P1-F8.6** House style lives in
  `packages/shared/src/change-request-prompt.ts`, mirroring
  `triage-prompt.ts`. Do not fetch the repository's own specs to derive style —
  that is a retrieval feature to be earned, and `docs/spec.md` is gitignored so
  it is not there to fetch.
- **P1-F8.7** Log to `agent_runs` with `step = 'change_request'`. The table
  needs no change. Respect the P1-F5.2 budget ceiling.
- **P1-F8.8** The drafted body must cite its source captures verbatim. The raw
  words are the requirement; the agent's prose is an interpretation of them, and
  the reviewer needs both.

#### Acceptance criteria

- Three related captures produce one coherent issue body in the house style,
  with the original wording quoted.
- A capture too vague to specify produces a `questions` entry rather than a
  confident invention.
- Cost appears in `agent_runs` and respects the ceiling.

---

### P1-F9 — Filing, and the handoff

**Priority:** P0 for this stage · **Depends on:** P1-F7

#### Requirements

- **P1-F9.1** A new Edge Function, `file-change-request`. It is the only place
  the GitHub credential exists.
- **P1-F9.2** The credential is a fine-grained personal access token, scoped to
  the single repository, with **`issues: write` and nothing else.** It must not
  carry `contents: write`. Reeve files issues; it does not push code. The coding
  agent has its own, separate credentials and they never meet.
- **P1-F9.3** Idempotent on `filing_key`. Before creating, search for an
  existing issue carrying that key. An approval that syncs twice from the
  outbox must not produce two issues.
- **P1-F9.4** The issue body carries the change request id and its source
  capture ids, so the trail from thought to diff is followable in both
  directions.
- **P1-F9.5** Handing off to a coding agent is **opt-in per request**, chosen at
  approval time. Filing an issue and asking for it to be built are different
  decisions, and some things want thinking about before they want implementing.
  Where opted in, the handoff is a `@claude` mention picked up by the Claude
  Code GitHub Action.
- **P1-F9.6** **Do not build the coding agent.** It exists, it is maintained,
  and it already runs in GitHub Actions with the right permission model. This
  stage's scope ends at a well-formed issue.
- **P1-F9.7** Add GitHub token patterns — `ghp_`, `github_pat_`, `gho_` — to
  `PATTERNS` in `scripts/check-bundle.mjs`. That script exists for exactly this
  class of mistake and currently has no entry for the credential this stage
  introduces.
- **P1-F9.8** Cap the number of open auto-filed issues (suggest 10). A drafting
  pass that misbehaves should hit a wall, not fill the repository. Refusing is
  correct behaviour; log it and alert.

#### Acceptance criteria

- Approving a change request creates exactly one issue, linked back to its
  captures.
- Replaying the same approval creates none.
- The token cannot push a commit, verified by attempting it.
- A build containing a GitHub token fails `check-bundle.mjs`.

---

### P1-F10 — Closing the loop

**Priority:** P1 for this stage · **Depends on:** P1-F9, hardening §4 Web Push

Without this, Reeve can send a thought outward and never learn what became of
it — which is exactly the open-loop problem `corrected_area_id` was designed to
avoid elsewhere.

#### Requirements

- **P1-F10.1** A GitHub webhook into an Edge Function, updating
  `change_requests.status` on pull request opened, merged and closed. Verify the
  webhook signature; this is an unauthenticated public endpoint and is the one
  new attack surface this stage introduces.
- **P1-F10.2** On merge: status `shipped`, `shipped_at` set, and the source
  captures marked accordingly. A thought becoming a deployed change is the most
  satisfying event this system can produce and it should be visible.
- **P1-F10.3** Push notification on `shipped`. Per the Stage 4 latency note, the
  contract here is "it will be there later, and you will be told."
- **P1-F10.4** Surface capture-to-shipped lead time. It is the only honest
  measure of whether this loop is working.
- **P1-F10.5** Surface the `reeve` share of total captures, weekly, alongside
  the P1-F3 taxonomy report. A rising share means the tool is eating its own
  purpose. This metric exists to be acted on, not admired.

#### Acceptance criteria

- Merging a pull request moves its change request to `shipped` and produces a
  push notification.
- An unsigned webhook request is rejected.
- The `reeve` capture share is visible in the weekly report.

---

### P1-F11 — Where this lives in the UI

**Not a third nav item.** `docs/archive/ui-spec.md`'s governing principle — *the thought
is fleeting; everything on screen either serves capturing it or gets deleted* —
applies with full force, and this is a weekly activity competing for space with
a daily one.

- **P1-F11.1** Entry is the existing `reeve` filter chip in the Inbox. The
  chip's presence is already the affordance; add a "Draft a change" action to
  the filtered view when unpromoted captures exist.
- **P1-F11.2** Review is one request at a time, full screen, in the pattern of
  `CaptureDetail`. The drafted body, the source captures quoted, the agent's
  questions, then Approve / Edit / Reject.
- **P1-F11.3** Approval is one deliberate tap. Not a confirm dialog — the
  reviewing *is* the confirmation, and a second modal trains the reflex this
  gate exists to prevent.
- **P1-F11.4** A permanent nav item is earned by finding yourself reaching for
  this daily. Until then it stays where it is.

---

### P1-F12 — Guardrails

This is a system that modifies itself. The constraints are the feature.

- **P1-F12.1** No auto-merge, ever, under any condition.
- **P1-F12.2** Branch protection on `main`, with the hardening F8 CI gates
  required. Those gates — typecheck, lint, unit tests, build, Playwright on both
  engines — are what make an agent-authored diff safe to look at.
- **P1-F12.3** Pull requests touching `.github/workflows/`,
  `supabase/migrations/`, `scripts/check-bundle.mjs`, or anything under
  `supabase/functions/` must be flagged for heightened review. These are the
  diffs that can disable the gates, alter data irreversibly, or reach
  credentials. The agent may propose them; they must never be skimmed.
- **P1-F12.4** Reeve has no deployment capability and never acquires one.
  Merging triggers the existing `deploy.yml`. Reeve's involvement ends at the
  issue.
- **P1-F12.5** Split credentials, as P1-F9.2 requires: the filing token cannot
  write code, the coding agent's token cannot file issues. Neither can reach
  Supabase.
- **P1-F12.6** The drafting agent reads captures. It does not read the database
  beyond them, and it has no write access to anything but its own
  `change_requests` row.

---

## 8. Stage 6 — described, not built

Following the pattern of `docs/spec.md` §9. Recorded so that Stage 1 to 5
decisions do not preclude it. **Do not build this.**

Stage 5 handles one action type — changing this repository — using a gate that
already existed. Everything else that acts on the outside world (email,
calendar, messages, anything touching money or third parties) has no such gate,
and needs the one below.

### The approval gate must be a table, not a blocked session

`docs/spec.md` §9 leans on Managed Agents'
`permission_policy: {type: "always_ask"}`, which blocks the *session* until
approval. That is a correct mechanism and the wrong primary control for this
user: a session that blocks while Chris is on a site for four hours is a
session that times out and loses its work.

Materialise the gate in Postgres instead:

```sql
create table proposals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  agent_run_id  uuid references agent_runs(id),
  action_type   text not null,          -- 'send_email', 'create_event', ...
  payload       jsonb not null,         -- everything needed to execute
  status        text not null default 'proposed',
                                        -- proposed|approved|rejected|executed|failed
  decided_at    timestamptz,
  executed_at   timestamptz,
  -- Idempotency key for the executor. An approval acted on twice must not
  -- send two emails.
  execution_key text unique not null,
  created_at    timestamptz not null default now()
);
```

The design constraints that follow, and that Stages 1 to 4 must not violate:

- **The agent's job ends at writing a proposal.** It never executes.
- **Execution is a separate, replayable step** triggered by approval, running
  in its own function with its own retry semantics and its own idempotency key.
- **The gate survives the agent process dying**, which over a long enough
  horizon it will. This is the property a blocked session cannot provide.
- **`always_ask` becomes a backstop**, not the mechanism. Defence in depth is
  fine; dependence is not.
- **Approval is delivered and answered by push.** Without it the gate is
  unusable in the field, which is the only place it matters.
- **Nothing is ever executed twice.** `execution_key` is the guarantee, not a
  convention.

This is also the point at which Managed Agents genuinely earns adoption: an
acting agent needs tools, credentials via vaults, and a sandbox. The one hard
rule from `docs/spec.md` §9 stands and becomes structural here rather than
conventional: **agents draft, Chris approves.**

---

## 9. Explicitly out of scope

Per the governing principle, each of these ships only when the stated
observation occurs.

| Deferred | Earned when |
|---|---|
| **Threads / projects** — explicit grouping of related captures | You repeatedly find yourself wanting to say "these belong together" and retrieval cannot infer it |
| **People as entities** — a `people` table with resolution across areas | You want to ask "what do I owe him" and free-text names across six overlapping areas make it unanswerable. This is the next thing that will be trapped in jsonb; do not pre-empt it |
| **`pgvector` embeddings** | P1-F4.2's recorded retrieval misses accumulate |
| **A corrections screen** | You find yourself running `pnpm triage:report` weekly |
| **User-authored commitments** — adding one without a capture | You observe yourself capturing a note purely to create a task, which means the capture is ceremony |
| **Per-area dashboards** | Named as out of scope in `docs/spec.md` §9 and nothing here changes that |
| **Any outbound action other than filing an issue on this repository** | Stage 6, behind §8's ledger. Not before |
| **Approving a pull request from inside Reeve** | You find yourself wanting to merge from your phone and the GitHub mobile app is the thing in the way. It is a perfectly good review surface and duplicating it is work with no payoff |

---

## 10. Sequencing

```
P1-F0  areas ownership ─────────────────────────► this week, independently

P1-F7  change requests ──► P1-F8  drafting ──► P1-F9  filing ──► P1-F10  loop
                                                                  Stage 5
P1-F1  commitments ──► P1-F2  Due view            Stage 1
P1-F3  corrections report ────────────────────►   Stage 2 — small, do it early
P1-F4  retrieval ─────────────────────────────►   Stage 3
P1-F5  cost ceiling ──► P1-F6  daily brief        Stage 4

                        Stage 6 — not built
```

Four notes on ordering:

**P1-F0 does not wait.** It is a live exposure and a five-line migration.

**Stage 5 is drawn first deliberately.** It is out of numerical order because
it is a force multiplier: every item below it becomes cheaper to record, draft
and act on once it exists. The counter-argument is that it is also the first
outbound write and therefore the first thing that can embarrass you, which is
why P1-F7.2 and the §7 guardrails are not negotiable. On balance, build it
early and hold the discipline.

**P1-F3 is disproportionately cheap.** Two SQL views and a script, against a
column that already contains real data. It should not queue behind Stage 1
simply because it is numbered later; if there is a spare afternoon, it is the
best use of one in this document.

**P1-F5 before P1-F6 and before P1-F8's scheduled pass, without exception.**
The first things that run unattended must not also be the first things with no
spending limit.

---

## 11. Definition of done

1. A second account on the project can read nothing personal belonging to the
   first.
2. "What did I say I would do this week?" is answered by opening the app, not
   by reading through an inbox.
3. Marking something done works on a building site with no signal.
4. The question "which classifier hint is wrong?" has an evidence-based answer.
5. A brief arrives, unprompted, referencing real outstanding obligations by
   name, and its cost is visible and capped.
6. A thought about the app, dictated away from a desk, has become a merged pull
   request without ever being typed a second time.
7. The system has still contacted no third party, moved no money, and sent no
   message on anyone's behalf.

Points 6 and 7 are the pair that matters, and they are not in tension.

Filing an issue on your own repository is an outbound write, and it is treated
as one — behind an explicit confirm step, an idempotency key, a scoped
credential and a capped rate. But its blast radius is a repository you own,
reviewed by you, revertible by you, and visible to nobody else. That is a
categorically different thing from an email arriving in a client's inbox.

Phase 1 is done when the system can change *itself* under review, and still
cannot reach *anyone*. Prove the substrate on the target where a mistake costs
a closed pull request, then decide whether to grant it further reach.
