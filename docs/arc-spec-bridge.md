# Reeve: The bridge

Status: **Built 2026-11-02 (branch `bridge`, not yet merged).** See §0.
Owner: spec-owned. Implementation runs in separate sessions; where this document is wrong,
ambiguous or silent, raise it against the spec rather than deciding it in the diff.
Extends: `spec.md` §9 ("agents draft, Chris approves"), `arc-spec-attention-queue.md`
AQ-4 (Go), AQ-5 (result loop), AQ-7 (Work board).
Audience: implementing agent, and Chris.
Feature IDs are prefixed `BR-`.

---

## 0. Implementation status

Built in one implementation session on 2026-11-02, the evening the spec was approved, as seven
commits on branch `bridge` in this repo plus one in `~/dotfiles`. Not pushed: CI has not run.

| Feature | State | Where |
|---|---|---|
| BR-0 areas → domains | **Done.** Seed rewritten (12 domains + `unsorted`, 6 retired `active=false`), seeded for Chris; `0016_areas_realign.sql` applied (0 rows remapped, as predicted); one `useAreas` hook with the `active` filter replaces four queries | `apps/web/src/lib/areas.ts`, `supabase/seed/areas.example.json` |
| BR-1 worker | **Done and running** as `reeve-bridge.service` (enabled, `active` since 18:28). Claim SQL in `db.ts`; NOTIFY wake-up proven: the smoke test was claimed in the same second it was dispatched | `apps/bridge/`, `~/dotfiles/systemd/…/reeve-bridge.service` |
| BR-2 routing | **Done.** Table in `apps/bridge/src/areas.ts`, one row per domain plus `unsorted` | |
| BR-3 run / return / push / record | **Done and proven** on the live stack (below) | `run.ts`, `worker.ts`, `push.ts` |
| BR-4 failure | **Done**; proven by killing a run mid-way (below) | |
| BR-5 Redo note | **Done.** Field on the review card; `actions.feedback`; prompt carries "Previous attempt" and "Chris said" | `ActionDetail.tsx`, `actions.ts` |
| BR-6 decompose | **Done** behind `actions.kind`: triage returns `decompose`, a mind dump becomes one `decompose` action, the bridge claims it without Go and inserts proposed actions and commitments. Proven by the live test with a stub runner; **not yet exercised with a real dictation** | `triage/index.ts`, `triage-prompt.ts`, `worker.ts` |
| BR-7 observability | **Done.** `box-status` has a bridge section; `~/backups/health/bridge.log` one line per run; `~/.local/state/bridge/<date>.log` | `~/dotfiles` |
| BR-8 envelope | **Done.** 6/hour, 30/day from `agent_runs`; pause pushes once. Allowlist unchanged | `ratelimit.ts` |

**Live verification (2026-11-02, Chris's account, area `ideas`).** Action
`0064009a-caee-4271-a891-949040b8ad8f` inserted as `dispatched` at 18:29:02; `NOTIFY` received
and claimed at 18:29:02 with `assignee=claude@quinn`; `claude -p` ran 12 s; `status=review` with
a three-line result at 18:29:14; `send-push` answered `{"sent":1}`; `agent_runs` row
`step=bridge, model=claude-fable-5-1, cost_usd=0.46, ok=true`. **BR-4:** action
`4590849b-e8b0-4c4a-a8e8-8934379815f3` dispatched 18:30:00, claimed the same second, its
`claude` process sent SIGTERM at 18:30:08; by 18:30:09 it was `review` with "Reeve could not
complete this: claude exited 143 …", `agent_runs.ok=false`, and a push `{"sent":1}`. Both test
actions and their captures were archived afterwards. Tests: 140 passing across 13
files (`pnpm test`, including `tests/bridge.test.ts` and the live `tests/bridge-live.test.ts`),
typecheck and lint clean.

**Deviations from the spec, decided in the diff and recorded here:**

1. Two migrations, `0016_areas_realign.sql` and `0017_bridge.sql`, not one `0016`: the remap
   and the schema change have different preconditions (the seed must run before the remap).
2. `redoAction` no longer clears `result`. BR-5.2 wants the previous attempt in the prompt, and
   nothing renders a result while an action is queued, so keeping it is free.
3. `agent_runs.cost_usd` records what the CLI reports (`total_cost_usd`) rather than null. It is
   list price, not what the subscription is charged, but it is the only number there is.
4. The claim prefers a dispatched task over a proposed `decompose`, and orders by
   `queue_position nulls last, coalesce(dispatched_at, created_at)`.
5. `contracting` and `charity` retired rather than added as domains thirteen and fourteen
   (Chris: "realign to vault domains").
6. The push body on a failure is the fixed "Could not complete it. Tap to see why." rather than
   the result's first line, which would be the error text on a lock screen.
7. The repo's pg scripts (`migrate`, `seed-areas`, `backfill`, `triage-report`) forced TLS and had
   not worked against the local pooler since the cutover; they now skip TLS for a localhost URL.
8. The integration test drives `processOnce` with a stub runner; the real headless run is proven
   by hand (above) rather than in CI, which cannot run Claude Code.
9. No build step: the unit runs `node apps/bridge/src/main.ts` on Node 24's type stripping, so
   the bridge package has `erasableSyntaxOnly` on.
10. The runner closes the CLI's stdin at once: with it open, `claude -p` waits three seconds for
    piped input on every run and warns about it (seen in the BR-4 probe's error text).
11. The working-state copy in `ActionDetail` ("Real agents return work themselves once §9 ships")
    now says the bridge does.

**Still open after this session:**

- `~/.claude/settings.json` allows `Edit(//home/chris/vaults/**)`, the pre-reorg path. Until it
  reads `vault`, a headless run cannot write a vault note (reads are fine). Claude is blocked
  from editing its own settings; Chris makes the one-word change.
- The e2e suite was not run locally: the box's resolver still has no answer for
  `api.chrisquinn.ie` (router cache after the nameserver move), so the built app cannot reach
  the API from here. Unit and live tests ran with `VITE_SUPABASE_URL=http://localhost:8001`.
  CI will run e2e on push.
- BR-6 with a real dictation, and the first week of real handoffs that §6 predicted would amend
  BR-3.1.
- `unsorted` runs are allowed (§7); revisit after a few.

## 1. Why now

The attention queue shipped the whole loop and left two steps hand-driven, by design:

- **Go** assembles a brief into `actions.brief`, sets `status='dispatched'`, and copies the
  brief to the clipboard for Chris to hand to an agent (AQ-4, `dispatchAction` in
  `apps/web/src/lib/actions.ts`).
- **The result** is pasted back by hand into `ActionDetail` (AQ-5, "paste the result to
  review it"), which sets `status='review'` and surfaces Approve / Redo in *Needs you*.

Both specs said the automation was `spec.md` §9 and would be "wiring, not redesign" once an
agent existed to receive the brief. As of today one does:

- The quinn machine runs Claude Code as an always-on session with a permission allowlist,
  skills, routines, a secrets store, and a single vault it can read and write
  (`~/vault`, see its `CLAUDE.md`).
- Reeve's database is on the same machine (`stacks/reeve`, reached as `postgres.reeve`
  through the pooler on `localhost:5433`). A worker can watch `actions` directly.
- `send-push` already delivers to the phone and takes `{ user_id, notification: { title, … } }`.

The observation that earns this: every Go since July has ended in a copy, a paste into a
terminal, and a paste back. That is the step the bridge removes. The approval gates stay
exactly where AQ-2 put them.

---

## 2. The model

Unchanged in shape from AQ §2; two arrows stop being manual.

```
 NEEDS YOU ── proposed action ── [ Go ] ──▶ Work board: Queued (status=dispatched)
                                                  │  bridge claims the head of the queue
                                                  ▼
                                           Working  (status=working, assignee=claude@quinn)
                                                  │  Claude runs the brief on the quinn machine:
                                                  │  reads, drafts, writes files under ~/vault or
                                                  │  a repo; never sends, pushes, or pays
                                                  ▼
 NEEDS YOU ── "Done. Here's what I did." ── status=review, result=…, push to phone
                [ Approve ] → done        [ Redo ] → back to Queued with Chris's note
```

Three rules the bridge must never break:

1. **It drafts.** Output is text and local files. No email, message, payment, DNS, push to a
   remote, PR, or any call that changes the world outside this machine. Approve means
   "this draft is right", not "send it". Acting on approvals is Stage 6 (`arc-spec-phase-1`
   §8), not this spec.
2. **It works inside the lines.** Claude's permission allowlist applies unchanged; a headless
   run cannot ask, so anything outside it is denied. `sensitivity: private` vault notes are
   not read unless the action's area is one of the six life domains (BR-2).
3. **It is one assistant, visible as one.** `assignee='claude@quinn'`, `started_at` set on
   pickup, one action at a time, and every run leaves a row in `agent_runs`.

---

## 3. Decisions taken with Chris (2026-11-02, before writing)

- One worker on the quinn machine, polling the local database. No cloud agent yet.
- Results are drafts; the approval tap stays in Reeve. Outbound execution is a later stage.
- Routing is by `area_id`: each area maps to a working directory, allowed directories, and the
  vault map that gives it context (§4 BR-2).
- The BOI boundary holds: a `boi` action runs with the vault only and may not touch
  anything else; it never connects to work systems.
- Mind-dump decomposition is the second thing the bridge does, as its own action kind (BR-6).

Answered by Chris after the first draft (2026-11-02):

- **Areas realign to the vault's twelve domains** (BR-0). Reeve's eight areas were written in
  July for a different shape of life; the vault list is the one agreed today. `contracting` and
  `charity` are not carried over: they are retired, not deleted, and come back as domains if the
  work does.
- **The code lives in `apps/bridge`** in this repo.
- **Only `decompose` skips Go** in v1.
- **Every result pushes** to the phone.
- **The identity string is `claude@quinn`.**

---

## 4. Features

### BR-0 — Areas become the vault's domains

Areas are per-user rows in `areas` (primary key `owner_id, id`; columns `label`,
`classifier_hint`, `colour`, `sort_order`, `active`), seeded by `scripts/seed-areas.mjs` from
the gitignored `supabase/seed/areas.json`, which upserts on `(owner_id, id)` including `active`.
Triage already drops inactive areas from the classifier's choices
(`supabase/functions/triage/index.ts`, `validIds`). So the realignment is a seed change plus one
data migration, not a schema change.

- **BR-0.1 New seed.** `areas.json` lists the twelve domains with the vault's exact ids and the
  scope column of `~/vault/CLAUDE.md` as the first line of each `classifier_hint`: `family`,
  `kids`, `home`, `health`, `money`, `admin`, `boi`, `baz`, `homeown`, `phibsboro`, `reeve`,
  `ideas`, plus `unsorted` (the routing sentinel the seeder requires; it is not a domain).
  `boi`'s hint says what the BOI boundary says: route here, never pull work content in.
- **BR-0.2 Retire the old ids.** The same file carries `contracting`, `homeownie`, `club`,
  `charity`, `dayjob`, `personal` with `active: false`. They stay as rows because `actions`,
  `captures` (`area_id` and `corrected_area_id`) and `commitments` reference `areas` by
  composite foreign key. On the live database Chris's data references only `reeve` (5 actions,
  15 captures) and `unsorted` (1 capture), so nothing needs remapping; the migration still
  remaps defensively: `homeownie→homeown`, `club→phibsboro`, `dayjob→boi`, `personal→family`,
  `contracting→money`, `charity→unsorted`, in that order, before the seed runs.
- **BR-0.3 App.** The web app's area pickers and filters (`CaptureSearch`, the triage
  correction sheet) do not filter on `active` today. They must, in the same change, or six dead
  areas appear in every chip row. Verified by grep on 2026-11-02: no `active` filter in
  `apps/web/src`.
- **BR-0.4 Vault.** `~/vault/CLAUDE.md` already states that Reeve's areas use these names; after
  BR-0 that sentence is true. No vault change.
- **BR-0.5 Tests.** Fixtures that assume `personal` or `club` exist (the triage and e2e seeds)
  move to the new ids. `areas.example.json` is rewritten to the new shape so a fresh clone
  seeds sensibly.

**Acceptance.** Triage offers only the twelve plus `unsorted`; the app shows only those; old
rows remain in the table inactive; `seed-areas` is idempotent on re-run.

### BR-1 — The worker

**New:** `apps/bridge/` (TypeScript, in the pnpm workspace; `pg` for the database,
`child_process` for `claude -p`). **New:** a systemd user unit `reeve-bridge.service` on quinn,
installed by `~/dotfiles/install.sh` like the routines.

- **BR-1.1 Claim.** Every 20 s (and immediately on `LISTEN actions_dispatched`, a `NOTIFY`
  raised by a small trigger on `actions`), claim the head of the Queued lane atomically:
  ```sql
  update actions set status='working', assignee='claude@quinn', started_at=now()
  where id = (select id from actions
              where status='dispatched' and archived_at is null
              order by queue_position nulls last, dispatched_at
              limit 1 for update skip locked)
  returning *;
  ```
  Exactly the order the Work board shows (`Work.tsx` sorts Queued by `queue_position`).
- **BR-1.2 One at a time.** The worker runs a single action to completion before claiming
  another. Concurrency is a later earn.
- **BR-1.3 Connection.** `DATABASE_URL` from `pass show env/reeve/DATABASE_URL` at start.
  Service role is not used for the claim; the `postgres` role through the pooler is.
- **BR-1.4 Kill switch.** `systemctl --user stop reeve-bridge` is the pause. A stop while
  working lets the current run finish (`KillMode=mixed`, `TimeoutStopSec=` the run timeout).

**Acceptance.** With the service running, Go on an action moves it to Working within 20 s
with the assistant shown on the card, and nothing else in the app changes.

### BR-2 — Context routing

Each area becomes a context the run starts in. The table is config in `apps/bridge/areas.ts`
(not the database: it names paths on one machine).

| `area_id` | Working dir | Also allowed | Vault map | Private notes | Notes |
|---|---|---|---|---|---|
| `family` | `~/vault` | | `family` | yes | |
| `kids` | `~/vault` | | `kids` | yes | |
| `home` | `~/vault` | | `home` | yes | |
| `health` | `~/vault` | `~/code/hydr` | `health` | yes | hydr read-only |
| `money` | `~/vault` | | `money` | yes | |
| `admin` | `~/vault` | `~/dotfiles`, `~/code/infra` | `admin` | yes | this machine; may draft config, never apply it |
| `boi` | `~/vault` | | `boi` | no | vault only; BOI boundary; no `~/code` |
| `baz` | `~/vault` | | `baz` | no | no repo on this machine yet |
| `homeown` | `~/vault` | `~/code/homeown-mvp` | `homeown` | no | product thinking first; code read-only |
| `phibsboro` | `~/vault` | `~/code/phibsboro` | `phibsboro` | no | |
| `reeve` | `~/code/reeve` | `~/vault`, `~/code/skills` | `reeve` | no | may write under `docs/` and the vault |
| `ideas` | `~/vault` | | `ideas` | no | |
| `unsorted` | `~/vault` | | `overview` | no | the run's first job is to say which domain it is |

"Private notes" is whether the run may read vault notes with `sensitivity: private`: the six
life domains yes, every work and project domain no. `kids` content is never summarised into a
result beyond what the brief itself contained.

- **BR-2.1** The run's prompt always includes the vault's `CLAUDE.md` rules and the area's
  map(s) by path, so filing and linking follow the vault's conventions.
- **BR-2.2** Writes are confined to the working dir, the also-allowed dirs, and `~/vault`.
  `--add-dir` carries the extra directories; the allowlist carries the rest.

**Acceptance.** A `phibsboro` action can read the phibsboro repo and write a note in the vault; a
`boi` action cannot see `~/code` at all; a `homeown` action cannot read a `private` note.

### BR-3 — The run

- **BR-3.1 Prompt.** `actions.brief` as assembled by the app (title, what Chris said, area,
  commitments), plus: the output contract below, the three rules from §2, the area context
  (BR-2.1), and, on a Redo, the previous `result` and Chris's note (BR-5).
- **BR-3.2 Invocation.** `claude -p <prompt> --output-format text --max-turns 80` in the
  working dir, `--add-dir` per BR-2, 40-minute timeout. The skills library is available;
  the prompt names `/ask-chris` as the router when the brief is a piece of work rather than a
  question.
- **BR-3.3 Output contract.** The run's final message is the result and must be plain text
  (`ActionDetail` renders `result` as text, not Markdown), under about 1,500 characters, in
  this shape:
  ```
  What I did: <two or three sentences>
  Where: <paths of files written or changed, one per line, or "nothing written">
  For you: <what Approve means here, and anything that needs a decision>
  ```
- **BR-3.4 Return.** On exit 0 with non-empty output: `result=<output>`, `status='review'`,
  `updated_at=now()`. Then `send-push` with `{ user_id, notification: { title: "Reeve: <action
  title>", body: first line of the result, url: "/#/needs-you" } }` using the service role key
  from `pass show infra/reeve/SERVICE_ROLE_KEY`.
- **BR-3.5 Record.** Insert an `agent_runs` row: `step='bridge'`, `capture_id`, `user_id`,
  `model` from the CLI's reported model, `duration_ms`, `ok`, `error`, `cost_usd=null`
  (Claude Code runs on the subscription; the ceilings in `brief` apply to API calls only).

**Acceptance.** An action goes dispatched → working → review without a human touching a
terminal; the result reads as the contract; the phone gets a push; `agent_runs` has the row.

### BR-4 — Failure

- **BR-4.1** Timeout, non-zero exit, or empty output → `status='review'` with
  `result = "Reeve could not complete this: <last 500 chars of stderr>"`, `ok=false` in
  `agent_runs`, and the same push. It surfaces as a decision, never silently re-queues.
- **BR-4.2** The worker survives its own failures (`Restart=always`), and never claims the
  same action twice in a row without a human decision in between.

**Acceptance.** Kill the CLI mid-run; the action lands in *Needs you* with the failure text.

### BR-5 — Redo carries a note

- **BR-5.1** `actions.feedback text` (migration `0016`). `redoAction` sets it from an optional
  text field in `ActionDetail`'s Redo flow; `approveAction` and the next pickup clear nothing,
  so the history stays in the row until the next Redo overwrites it.
- **BR-5.2** On pickup, if `feedback` or a previous `result` exists, both go into the prompt
  under "Previous attempt" and "Chris said".

Without this the second pass is blind. Small, and it is what makes Redo useful.

**Acceptance.** Redo with a note; the next result addresses the note.

### BR-6 — Decompose (the mind dump)

- **BR-6.1** `actions.kind action_kind not null default 'task'`, values `task | decompose`
  (migration `0016`).
- **BR-6.2** The triage producer (`supabase/functions/triage`, prompt in `packages/shared`)
  gains one judgment: when a capture contains three or more distinct intents, it proposes a
  single action of kind `decompose` titled "Break this down: <summary>", instead of one task.
  Conservative, per AQ §8 Q1.
- **BR-6.3** A `decompose` action does not wait for Go. The bridge claims it as soon as it is
  proposed (`status='proposed' and kind='decompose'`), because decomposing is drafting: it
  creates **proposed** actions (one per task, each with its own brief), commitments for dated
  items (the same shape `writeCommitments` uses), and notes for the rest, filed in the vault's
  `+/fleeting/reeve/`. The original capture stays filed; the decompose action's `result` lists
  what was created and goes to `review` like any other.
- **BR-6.4** Every proposed action the decomposition creates still needs Go. Nothing is
  dispatched by the bridge on its own.

**Acceptance.** A six-item dictation yields one review card listing six new proposed actions
and two commitments, all visible in *Needs you* and *Due*, and nothing dispatched.

### BR-7 — Observability

- The Work board already shows `assignee` and `started_at`; nothing to add.
- `box-status` gains a line: bridge active, last claim, last result, failures today.
- The bridge logs to `~/.local/state/bridge/<date>.log`; the health line records runs/failures.

### BR-8 — Safety envelope

- Rate limit: at most 6 runs per hour and 30 per day; beyond that the bridge pauses and
  pushes "Bridge paused: daily limit". Numbers are config.
- Hard allowlist of what a run may do comes from `~/.claude/settings.json`; the bridge adds
  nothing to it. In particular `git push`, `gh pr create`, `curl -X POST` to anything outside
  `localhost`, and `pass insert` remain denied for headless runs.
- A run that produces a file outside its allowed directories is a bug in the allowlist, not
  something the bridge checks for.

---

## 5. Deliberately not in this spec

- **Executing approvals** (sending the email the draft wrote, merging the PR). That is the
  approval ledger, Stage 6. The bridge makes it worth building.
- **Multiple assistants or parallel runs.** `assignee` is a text column for exactly this
  reason; earn it.
- **Managed Agents / cloud execution.** `spec.md` §9 keeps the door open; nothing here closes
  it. The bridge is the self-hosted shape of the same loop.
- **A rich result view.** `result` stays plain text until a Markdown result is wanted twice.
- **Reeve-area actions through the change-request pipeline.** Still the deferred AQ-4 gap;
  the bridge treats `reeve` like any area (read code, draft in `docs/` and the vault).

---

## 6. Build order

0. BR-0: new `areas.json`, remap migration, `active` filters in the app, fixtures. Seed with
   `pnpm db:seed --owner <chris>` against the self-hosted database.
1. Migration `0016`: `kind`, `feedback`, the `NOTIFY` trigger. Apply to the self-hosted
   database with the repo's migration runner.
2. `apps/bridge`: claim, run, return, record, push. Unit tests for claim SQL, prompt assembly,
   output parsing, rate limit. One integration test against the local stack that dispatches a
   trivial action and asserts `review`.
3. systemd unit + `install.sh` + `box-status` line.
4. BR-5 Redo note in the app.
5. BR-6 triage change and decompose handling, behind the `kind` column, last.

Half a day for 0, a day for 1–3, half a day each for 4 and 5. The first real handoff will show what the brief is
missing (AQ §8 Q3); expect to amend BR-3.1 after a week of use.

---

## 7. Open questions, resolved 2026-11-02

All five were put to Chris after the first draft and answered the same evening; the answers are
recorded in §3 and applied in BR-0, BR-2 and BR-3. For the record:

1. Areas versus vault domains: **realign Reeve to the twelve** (BR-0). `contracting` and
   `charity` retire rather than becoming domains thirteen and fourteen.
2. Where the code lives: **`apps/bridge`**.
3. Auto-pickup beyond decompose: **no**, not in v1.
4. Push on every result: **yes**.
5. Identity string: **`claude@quinn`**.

Open for the implementation session to raise, not decide: whether `unsorted` runs should be
allowed at all, or should fail fast with "pick a domain first". The spec says run, and let the
result's first line be the domain.
---

## 8. Sources & coverage

- `arc-spec-attention-queue.md` §0, §2, AQ-4, AQ-5, AQ-7, §8 (read 2026-11-02).
- `spec.md` §9 (end state), `arc-spec-phase-1.md` §8 (approval ledger, not approved).
- `apps/web/src/lib/actions.ts` (`dispatchAction`, `redoAction`, `endOfQueue`),
  `apps/web/src/lib/brief.ts` (`assembleBrief`), `apps/web/src/screens/Work.tsx` (Queued
  order), `apps/web/src/components/ActionDetail.tsx` (`result` rendered as text).
- `supabase/functions/send-push/index.ts` (`{ user_id, notification }` contract).
- Live database: `action_status` = proposed, dispatched, review, done, declined, working;
  `actions` columns include `brief`, `result`, `queue_position`, `assignee`, `started_at`,
  `dispatched_at`; `agent_runs.step` values today are `triage`, `brief`, `change_request`;
  the eight areas listed in Q1; realtime publication covers `actions`.
- `scripts/seed-areas.mjs` (upsert incl. `active`), `supabase/seed/areas.json`,
  `supabase/functions/triage/index.ts:119` (inactive areas excluded), `areas` constraints
  (composite primary key; FKs from `actions`, `captures` ×2, `commitments`), live area usage
  counts for Chris's user.
- Machine side: `~/dotfiles/docs/routines.md`, `~/vault/CLAUDE.md`, the decision cards
  `2026-11-02-agents-draft-chris-approves` and `2026-11-02-boi-boundary`.

### Verified against the code

- Go writes `status='dispatched'`, `dispatched_at`, `queue_position=endOfQueue()`, and the
  brief; Redo writes `status='dispatched'`, `result=null`, `assignee=null`, a new
  `queue_position`. There is no feedback column: BR-5 adds it.
- `actions` has no `kind` column: BR-6 adds it.
- `ActionDetail` renders `action.result` inside a text element; no Markdown renderer is a
  dependency of `apps/web`.
- `useRealtimeChannel` subscribes to `actions` with `user_id=eq.<uid>`, so a status change
  by the bridge reaches the open app without a reload.
