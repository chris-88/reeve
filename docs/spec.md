# Reeve, second edition

Status: **Approved to build, 2026-11-03.** Chris: "second edition it is, GitHub loop goes."
Owner: spec-owned. This is the only current specification. Everything in `docs/archive/` is
history: read it to learn why something was built, never to pick work from it.
Audience: the implementing agent, and Chris.

---

## 0. How to read this

The first edition grew by accretion: a product spec, six architecture specs, two ID schemes,
a change-request pipeline built because no agent could run anywhere, and a UI shaped around a
copy-and-paste handoff. All of it was reasonable when written and most of it is now wrong. This
document restates Reeve from today's model. If something from the first edition is not named
here, it is gone. The implementing session records deviations in §14, not in the diff.

Feature IDs are prefixed `E-` (edition). Build order is §11.

## 1. What Reeve is

Reeve is Chris's assistant. He captures a thought on his phone; Reeve files it, turns it into
work, does the work on his machine, and brings back a draft for a yes or no. The app is the
smallest possible surface over that loop. The thinking lives in the vault, the doing happens on
the machine, and the phone is for capture and decisions.

### The five rules

1. **Features are earned by observed need, not anticipated need.** Ship the thin path, live
   with it a fortnight, let the friction decide. This killed audio, kanban, dashboards, and the
   GitHub loop; it stays in force.
2. **Reeve drafts; Chris approves; Approve acts.** A run produces text and local files and
   stops. The Approve tap is the gate for anything outbound: once a connector exists, Approve
   on a drafted email sends it from Reeve's account and Approve on a proposed event creates
   it. Chris governs the consequences (2026-11-03: "move fast and break things... I will
   govern that"). Nothing outbound happens without a tap; nothing waits for more than one.
3. **Captures are never dropped.** The outbox, the service worker, and the durability tests
   exist for this one invariant. It is the only part of the first edition carried over
   unchanged and unquestioned.
4. **One assistant, visible as one.** `claude@quinn`, one action at a time, every run logged.
5. **The BOI boundary.** Nothing from Chris's employer's systems touches this machine. The
   `boi` domain exists so those thoughts have somewhere to go; a run in that domain gets the
   vault only, no code, no mail, no calendar.

### Minimal means

Two destinations and a search. No board, no drag, no lanes, no greeting, no settings page with
more than three switches. Every element on a screen is there because a tap on it changes
something. When in doubt, remove it and wait for the friction.

## 2. The model

```
 capture ──▶ triage ──▶ proposed action(s) + commitments + a filed note
                              │
                        [ Hand to Reeve ]            (or: nothing, it was just a note)
                              │
                        bridge claims it, works in the right directory with the right
                        context, drafts, writes the result
                              │
                      "Done. Here's what I did."  ──▶  Approve ─▶ done
                                                   └─▶ Redo with a note ─▶ back to the bridge
```

- **Capture** is text (typed or dictated) from the phone or desktop. Offline-first, durable.
- **Triage** classifies the capture to a **domain**, gives it a title and summary, extracts
  commitments with dates, and proposes zero or more **actions**. A mind dump with several
  intents proposes one `decompose` action, which the bridge runs without being asked and which
  produces the real actions and commitments.
- **Domains** are the vault's twelve (`family`, `kids`, `home`, `health`, `money`, `admin`,
  `boi`, `baz`, `homeown`, `phibsboro`, `reeve`, `ideas`) plus `unsorted`. The table keeps its
  first-edition name `areas` to avoid a column rename across every table; the word in the
  product is "domain". Each domain routes the bridge to a working directory, allowed
  directories, vault maps, and connector accounts (§7, §8).
- **Actions** have a `kind` (`task`, `decompose`) and a status: `proposed` → `dispatched` →
  `working` → `review` → `done`, or `declined` at any point. `dispatched` and `working` are
  Reeve's states; Chris sees them as one line, "Reeve has it".
- **Commitments** are dated promises extracted from captures. They are what the morning says.
- **Results** are plain text in a fixed shape (what I did, where, for you) plus files under
  the vault or a repo. A Redo carries Chris's note to the next attempt.
- **Reeve changing itself** is a `reeve`-domain action like any other: the bridge drafts in
  `~/code/reeve` on a local branch `reeve/<short-id>`, commits, never pushes, and the result
  says what changed and how to try it. Shipping is a sentence from Chris to the machine
  session, which is on rolling deploy. The issue→PR→webhook pipeline is retired.

## 3. Architecture

| Component | Where | Holds truth for |
|---|---|---|
| PWA | `apps/web`, served at app.chrisquinn.ie from GitHub Pages | Nothing. Reads and writes the API; an outbox for what has not reached it yet |
| Self-hosted Supabase | `~/code/infra/stacks/reeve`, API at api.chrisquinn.ie/reeve | Captures, actions, commitments, domains, subscriptions, run log |
| Edge functions | the stack's functions container | Triage, push sending, due reminders, the morning brief |
| Bridge | `apps/bridge`, user service `reeve-bridge` on quinn | The work itself: claims actions, runs Claude Code headlessly, writes results |
| Vault | `~/vault`, private repo | The second brain: maps, cards, efforts, Reeve's filed notes |
| Connectors | `gog` CLI with two Google accounts (§8) | Nothing. Mail and calendar stay in Google |
| Machine session | the `reeve` tmux session on quinn | Shipping, provisioning, anything outside the bridge's envelope |

Secrets: the browser holds the anon key only. Functions hold the service key and the Anthropic
key. The bridge reads `pass` at start. Nothing in `.env` files is read by anything but the local
dev build.

## 4. Data model

### Kept, as is
`captures` (with `search_tsv`, `corrected_area_id` for triage quality), `actions` (with `kind`,
`brief`, `result`, `feedback`, `assignee`, `queue_position`, `stuck_alerted_at`), `commitments`,
`areas`, `push_subscriptions`, `agent_runs`, `agent_spend_daily`, `agent_spend_monthly`,
`briefs`, `_reeve_migrations`. Enums `action_kind`, `action_status`, `capture_source`,
`capture_status`, `commitment_status`.

### E-1 Dropped
- Tables `change_requests`, `change_request_captures`; view `change_request_leadtime`; enum
  `change_request_status`; functions `enforce_one_change_request_per_capture`,
  `sweep_change_requests`; cron job `reeve-file-sweep`.
- View `reeve_capture_share` (it measured the pipeline that is going).
- `triage_corrections` and `triage_rates` stay: they measure triage, which stays.
- Edge functions `draft-change-request`, `file-change-request`, `github-webhook`, and the
  shared modules `change-request-prompt.ts`, `github.ts`. The GitHub webhook on the repo, the
  `GITHUB_ISSUES_TOKEN` and `GITHUB_WEBHOOK_SECRET` secrets in the stack and in `pass`, the
  `claude.yml` workflow, and the Caddy route that injected the anon key for the webhook.
- The five rows of `change_requests` are exported to
  `~/vault/x/sources/reeve/change-requests-2026-11.json` before the drop. Nothing else is lost.

### E-2 Small additions
- `actions.result_files text[]`: paths the run wrote, parsed from the result's "Where" lines,
  so the card can show them without reparsing text.
- `captures.filed_path text`: where the bridge filed the note in the vault, if it did. The app
  shows it as a one-line pointer.
- `captures.file_requested boolean not null default false`: set by triage when a capture is a
  note rather than an action or a commitment; the bridge polls it (§6 E-9).
- A `domains` view over `areas where active` with the product's column names, for the app's
  reads. Writes still go to `areas`.

### Migration
One migration, `0019_second_edition.sql`, does all of E-1 and E-2, after the export. The
seeder and `areas.example.json` are already on the twelve domains.

## 5. The app

### E-3 Two destinations and a search

| Screen | Route | What is on it |
|---|---|---|
| **Capture** | `#/` | One text area, one Save. The outbox indicator when something is unsent. Nothing else. |
| **Today** | `#/today`, `#/today/<actionId>` | Three sections in this order, each hidden when empty: **Needs you** (proposed and review cards), **Reeve has it** (dispatched and working, one line each, no interaction), **Due** (overdue, today, next seven days). |
| **Library** | `#/library`, `#/library/<captureId>` | Search over captures with the domain chips. Opened from an icon on Today. |

Settings is a sheet from Today: notifications on or off, sign out, the app version. That is the
whole surface. The Work board, the Inbox, the change-request views, the drag reorder, the
greeting, and the separate Due screen are gone.

### E-4 Cards
- A **proposed** card: title, domain, one-line summary. Actions: **Hand to Reeve**, **Decline**,
  **Tweak** (edit title and domain in place). No clipboard.
- A **review** card: title, the result in its three parts, the files as a short list. Actions:
  **Approve**, **Redo** with a note field, **Copy brief** in an overflow for the day the bridge
  is down.
- A **decompose** review card lists what was created, each a link into Today.
- A **commitment** row: text, when, the capture it came from. Actions: **Done**, **Drop**.

### E-5 Carried over as libraries, not rewritten
`lib/outbox.ts`, `sw.ts` (push, click routing, cache matchers on the configured API origin),
`lib/push.ts`, `lib/pushAsk.ts`, `lib/badge.ts`, `lib/draft.ts`, `lib/query.ts` (persisted
cache), `lib/useRealtimeChannel.ts`, `lib/route.ts`, `lib/session.ts`, `lib/env.ts`, and the
`e2e/offline.spec.ts` and `e2e/capture.spec.ts` suites that prove rule 3. These move as files
with their tests. Everything under `screens/` and `components/` is written new against E-3 and
E-4; `components/ui/` keeps whichever shadcn primitives the new screens use and drops the rest.
`@dnd-kit/*` leaves `package.json`.

### E-6 Behaviour that stays
Deep links from notifications open the card. The icon badge is the Needs you count. The
permission ask appears after the first Hand to Reeve. A reload keeps the screen. Realtime keeps
Today live without a refetch storm: the payload is applied to the cache, the one piece of the
first edition's hardening that was never finished; do it now while the screens are new.

**Acceptance for the app.** Offline capture of three thoughts, airplane mode off, all three
filed within fifteen seconds. Hand one to Reeve, approve the result from the notification's
deep link, badge goes to zero. Lighthouse PWA installable. No `dnd-kit`, no `Inbox.tsx`.

## 6. Triage

Unchanged in mechanics (one Claude call, the shared prompt, retries, the stuck alert). Three
changes:

- **E-7** The prompt describes the twelve domains with the vault's scope line for each. The
  `boi` hint says: route here, extract nothing beyond a title.
- **E-8** Dates and times in the capture always become `due_at` when the day can be resolved
  ("at 21:04" is today; "Friday" is the next Friday; "the 14th" is the next 14th). Yesterday's
  "Send a notification at 21:04" was stored undated; that is the failing case for the test.
- **E-9** Triage files a note. For a capture that is not an action and not a commitment, triage
  sets `file_requested`; the bridge (the only component that can reach the vault) writes it to
  `~/vault/+/fleeting/<domain>/<date>-<slug>.md` with the vault's front matter and sets
  `captures.filed_path`. This is how the vault becomes the second brain without Chris filing
  anything by hand. `boi` captures are never filed with content, title only.

## 7. The bridge

Built 2026-11-02 and kept whole. Its contract, restated so this document stands alone:

- Claims the oldest `dispatched` action (and any `proposed` action of kind `decompose`, and any
  capture with `file_requested`) atomically, one at a time, woken by `NOTIFY` or a 20-second
  poll.
- Runs `claude -p` in the domain's working directory with the domain's allowed directories,
  the vault's rules, the brief, and on a Redo the previous result and Chris's note. Never with
  permissions skipped; the machine's allowlist is the envelope.
- Returns a three-part plain-text result, sets `review`, logs an `agent_runs` row, pushes.
- Fails loudly: a timeout or non-zero exit is a review card that says so.
- Rate limited: six runs an hour, thirty a day, then a "paused" push.
- Stopping the service is the pause. The live test suite refuses to run while it is active.

### E-10 Domain routing table (config in `apps/bridge/src/areas.ts`)

| Domain | Working dir | Also allowed | Private notes | Connector accounts |
|---|---|---|---|---|
| family, kids, home, money | `~/vault` | | yes | `chris` (read) |
| health | `~/vault` | `~/code/hydr` read-only | yes | `chris` (read) |
| admin | `~/vault` | `~/dotfiles`, `~/code/infra` | yes | `chris` (read), `reeve` |
| boi | `~/vault` | | no | none |
| baz | `~/vault` | | no | `reeve` |
| homeown | `~/vault` | `~/code/homeown-mvp` read-only | no | `reeve` |
| phibsboro | `~/vault` | `~/code/phibsboro` | no | `reeve` |
| reeve | `~/code/reeve` | `~/vault`, `~/code/skills` | no | `reeve` |
| ideas | `~/vault` | | no | `chris` (read) |
| unsorted | `~/vault` | | no | none; first job is to name the domain |

"Private notes" is whether vault notes with `sensitivity: private` may be read.

## 8. Connectors

### E-11 Gmail and Calendar through `gog`
Two Google accounts, authorised once by Chris, tokens in the CLI's file keyring with the
password in `pass` (`infra/gog/KEYRING_PASSWORD`), used only by bridge runs through a `/gmail`
and `/calendar` skill in the skills library.

| Alias | Account | Gmail | Calendar | Available to |
|---|---|---|---|---|
| `chris` | Chris's personal Gmail | `readonly`, enforced by Google | read-only | per §7 table |
| `reeve` | reeve.has.mail@gmail.com | `read-send` | full | per §7 table |

Rules, enforced by the allowlist and by the skill's instructions:
- `gog --readonly` for every read. During a run, `gog --account reeve gmail drafts create` is
  the only write; `gmail send`, `calendar create`, `calendar respond` run only from Approve
  (§9, E5), never from inside a bridge run.
- Nothing from Chris's mailbox is quoted into the vault or into a draft without his approval;
  results summarise. Mail content never enters the `boi` domain's runs at all.
- Reeve's own address can later become `reeve@chrisquinn.ie` by Cloudflare Email Routing into
  that mailbox; not now.

Health: `gog --no-input --json auth doctor --check` in `box-status`.

### What a connector gives the bridge, concretely
"Reply to the club treasurer about the pitch invoice" becomes: read the thread from `chris`,
draft the reply in `reeve`'s drafts folder, result says what the draft says and where it is.
"What's on Thursday" becomes a result listing the day from `chris`'s calendar.

## 9. Approve acts

Approve is the one gate. A review card whose result proposes an outbound step (send this
draft, create this event, push this branch) says so in its "For you" part, and Approve
performs it, once, through the same connector the run used. Idempotency is per action: a second
Approve on the same card does nothing. There is no separate ledger, queue, or second
confirmation; if a mistake shows one is needed, the write-up after it decides what to add
(§14). Mistakes on outbound surfaces are Chris's to clean up by his own instruction, and are
reported plainly, never softened.

## 10. Notifications and the morning

Unchanged from 2026-11-02 and restated:
- Every result, failure, and decompose pushes with a deep link to the card and a per-action
  tag, so a Redo replaces the first notification.
- 07:30 Dublin: due reminder, only when something is due or overdue. 05:10 UTC: the morning
  brief, title "Today", deep link to Today.
- **E-12** The brief's prompt drops every mention of change requests and gains the vault's
  effort trackers (`~/vault/efforts/*.md`, status `doing`) as context, read by the bridge the
  evening before and stored alongside the brief's inputs.
- A `dispatched` action unclaimed for thirty minutes pushes "Reeve hasn't picked this up".
- iPhone shows no notification buttons; approval is one tap away in the app.

## 11. Build order

| Step | What | Done when |
|---|---|---|
| E0 | This document; first edition archived | `docs/` holds `spec.md` and `archive/` only |
| E1 | Export change requests to the vault; migration 0019; retire the three functions, their secrets, the GitHub webhook, the `claude.yml` workflow, the Caddy route, the cron job; prune `packages/shared` | Stack healthy, `pnpm test` green, nothing references change requests |
| E2 | The app: new `screens/` and `components/`, libraries moved, routes, Today, Library, Settings sheet, E-6 realtime cache application; e2e for the acceptance in §5 | Deployed by rolling deploy; Chris's checklist on the phone passes |
| E3 | Triage E-7, E-8, E-9; bridge filing and `filed_path`; E-12 brief context | A dated capture gets `due_at`; a note capture appears in `+/fleeting/<domain>/` |
| E4 | Connectors E-11: `gog` setup (Chris's human steps are done except the OAuth client), two accounts, allowlist rules, skills, bridge routing column | A `phibsboro` action reads a thread and leaves a draft in Reeve's mailbox |
| E5 | Approve acts (§9): send a draft, create an event, push a branch, from the review card | A drafted reply sends on Approve and the card records it |

E1 and E2 are separate sessions and separate deploys; E1 is safe on its own because the app's
current code never reads the dropped tables on a hot path (the change-request screens are
unmounted). E3 and E4 can run in parallel.

## 12. Deliberately not in the second edition

Each with the friction that would earn it:
- Audio capture: dictation is on-device. Earned never, probably.
- Multiple assistants, parallel runs, an assistants table: a second real assistant.
- Any board, lane, or drag: wanting to reorder more than once a week.
- Per-domain dashboards, lists, a calendar screen, people as entities, threads: the vault has
  maps, `x/people/`, and `efforts/`; a want that the vault cannot answer.
- Screenshot attachments: the August branch exists; earned when a capture needs an image more
  than once a week. Rebase it then.
- pgvector or any retrieval beyond trigram search: three recorded misses.
- Light theme, animation, a notifications history, password reset (single user, sessions
  live long).
- A proposals ledger or second confirmation step: a mistake that a single Approve tap could not have prevented.

## 13. Decisions taken in this document

- `areas` keeps its table name; the product says "domain".
- Due merges into Today; the Work board becomes a read-only strip; the Library is a search,
  not a tab.
- Reeve changes itself through local branches and a sentence to the machine session, not
  through GitHub issues.
- Triage requests filing; the bridge files (the function cannot reach the vault).
- The first-edition `spec.md` was gitignored as personal content and now lives in the vault
  (`cards/canonical/reeve/spec-first-edition.md`). This edition names domains by their labels
  only and is tracked in the public repo; the detailed scopes stay in the vault's `CLAUDE.md`
  and the gitignored `areas.json`.

## 14. Deviations found while building

Written by the implementing sessions, one line each, newest first.

(none yet)
