# Reeve: Architecture Spec — Phase 1

Status: Proposed. Not yet approved to build
Extends: `docs/spec.md` (Phase 0)
Sibling: `docs/arc-spec-pwa-hardening.md`
Audience: implementing dev team

Feature IDs in this document are prefixed `P1-` and are numbered independently
of the PWA hardening spec.

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
that cannot do harm. Stage 5 is described but explicitly not built.

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
| Stage 5 | Everything, plus §6 of this document |

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

## 7. Stage 5 — described, not built

Following the pattern of `docs/spec.md` §9. Recorded so that Stage 1 to 4
decisions do not preclude it. **Do not build this.**

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

## 8. Explicitly out of scope

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
| **Any outbound action** | Stage 5, behind §7's ledger. Not before |

---

## 9. Sequencing

```
P1-F0  areas ownership ─────────────────────────► this week, independently

P1-F1  commitments ──► P1-F2  Due view            Stage 1
P1-F3  corrections report ────────────────────►   Stage 2 — small, do it early
P1-F4  retrieval ─────────────────────────────►   Stage 3
P1-F5  cost ceiling ──► P1-F6  daily brief        Stage 4

                        Stage 5 — not built
```

Three notes on ordering:

**P1-F0 does not wait.** It is a live exposure and a five-line migration.

**P1-F3 is disproportionately cheap.** Two SQL views and a script, against a
column that already contains real data. It should not queue behind Stage 1
simply because it is numbered later; if there is a spare afternoon, it is the
best use of one in this document.

**P1-F5 before P1-F6, without exception.** The first thing that runs unattended
must not also be the first thing with no spending limit.

---

## 10. Definition of done

1. A second account on the project can read nothing personal belonging to the
   first.
2. "What did I say I would do this week?" is answered by opening the app, not
   by reading through an inbox.
3. Marking something done works on a building site with no signal.
4. The question "which classifier hint is wrong?" has an evidence-based answer.
5. A brief arrives, unprompted, referencing real outstanding obligations by
   name, and its cost is visible and capped.
6. Nothing in the system has yet sent anything to anyone.

Point 6 is deliberate. Phase 1 is done when the system is useful and still
cannot act. That is the correct order: prove the substrate, then grant it
reach.
