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

One thread. No tabs, no board, no drag, no lanes, no greeting, no settings page with more than
three switches. Every element on the screen is there because a tap on it changes something.
When in doubt, remove it and wait for the friction.

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

## 5. The app: the thread

Decided with Chris on 2026-11-03 after the first E-3 draft (two destinations and a search)
still felt over-engineered: "frictionless, an assistant that is only exposing things as
needed". The app is one screen that reads like a conversation with Reeve.

### E-3 One screen

| Element | What it is |
|---|---|
| **Composer** | Pinned to the bottom. Placeholder "Tell Reeve…". Send on ⏎ or the arrow. Writes through the outbox; a message shows "sending" until it is durable and never disappears on failure. Dictation is the keyboard's. |
| **Thread** | Everything, newest at the bottom, opened scrolled to the bottom. Older messages load when you scroll up (keyset pagination, the first place it was ever needed). |
| **Header** | "Reeve", a search icon, a settings icon, and a small count chip ("3 need you") that appears only when something does; tapping it scrolls to the oldest message still waiting. |

There are no tabs, no Today, no Library screen, no Work board, no Due screen. Search filters
the thread in place (text plus domain chips) and clears with one tap. Settings is a sheet:
notifications, sign out, version.

### E-4 Messages

Every row is a message from you or from Reeve. Reeve speaks in the first person, in one to
three short sentences, never with headings. Two visual weights, and only two:

- **Bubbles** for talk: your captures, "filed", "on it", the brief, notices. Plain text, no
  border, no buttons.
- **Cards** for decisions (Chris, 2026-11-03: "some cards needed within the thread for
  approvals"). A card sits in the thread at the same width as a bubble but has a border, a
  title line, the content you are deciding on (the draft's first lines, the event's when and
  where, the item list), and one or two buttons. Decisions are taps on the card, never typed
  replies. Once acted on, a card collapses to one quiet line ("Approved · 08:20", "Sent from
  my account · 08:21", "Done ✓") and can be expanded again with a tap.

Cards: proposed, result, failed, decomposed, due. Bubbles: everything else.

| Message | From | Body | Buttons |
|---|---|---|---|
| capture | you | Your text as typed | none (long-press: edit domain or title, archive) |
| filed | Reeve | "Filed under home: garden plan. I'll remind you Friday." (title, domain, any commitment it created, the vault path as a quiet pointer) | none |
| proposed | Reeve | "I could book the dentist for next week. Want me to?" (the action's title and one-line brief) | **Hand to Reeve** · **Not now** |
| working | Reeve | "On it." Updates in place to the result; never a second message | none |
| result | Reeve | The run's three parts rewritten as prose: what I did, where, what Approve means. Files as a short list | **Approve** (or **Send it** / **Create it** when Approve acts, §9) · **Redo…** |
| redo note | you | Your note, shown as your message under the result | none |
| failed | Reeve | "I couldn't finish this: …" | **Try again** · **Drop it** |
| decomposed | Reeve | "That was six things. I've proposed four actions and set two reminders:" followed by the items, each a link to its own message | none |
| due | Reeve | Every morning at 07:30 when something is due or overdue: "Two things today: dentist 15:00, club AGM form." One tick per item | **Done ✓** per item |
| brief | Reeve | The morning brief, 05:10 | none |
| paused / stalled | Reeve | "I've hit today's limit; I'll carry on tomorrow." / "I haven't picked this up yet; is the machine awake?" | none |

**Redo…** opens a one-line field inside the result message; sending it posts your note as a
message and re-queues the action. **Hand to Reeve** turns the proposed message into
"On it." without a new row.

### E-5 Data: the thread is a view

No new table. `thread_events` is a Postgres view that unions `captures`, `actions` (one event
per status that matters: proposed, working, review, done/declined), `commitments` (created,
and the due digest is an `agent_runs` row of step `due`), `briefs`, and the bridge's paused and
stalled notices, each with `happened_at`, `kind`, `ref_id`, `user_id`, and the columns the
message needs. The app reads the view with keyset pagination on `(happened_at, id)` and
subscribes to realtime on the underlying tables, applying payloads to the cache (the old
F9.4). Mutations go to the real tables through the existing library functions.

### E-3b Carried over as libraries, not rewritten
`lib/outbox.ts`, `sw.ts` (push, click routing, cache matchers on the configured API origin),
`lib/push.ts`, `lib/pushAsk.ts`, `lib/badge.ts`, `lib/draft.ts`, `lib/query.ts`,
`lib/useRealtimeChannel.ts`, `lib/route.ts`, `lib/session.ts`, `lib/env.ts`, and the
`e2e/offline.spec.ts` and `e2e/capture.spec.ts` suites, adapted to the composer. Everything
under `screens/` and `components/` is written new; `components/ui/` keeps only what the thread
uses. `@dnd-kit/*` leaves `package.json`.

### E-3c Behaviour that stays
Routes: `#/` the thread, `#/m/<id>` scrolls to and highlights one message (notification deep
links use it). The icon badge is the count of messages that need you. The permission ask is a
Reeve message after your first Hand to Reeve ("Want me to tell you when it's done?" with
**Yes** · **Not now**). A reload keeps your place.

**Acceptance.** Offline, type three messages in airplane mode; back online, all three file
within fifteen seconds and their "filed" replies appear without a reload. Hand one to Reeve,
tap the push, land on the result, Approve, badge goes to zero, the message collapses to its
one line. Scroll up through a month of history without a spinner longer than a beat.

### E-6 Look and motion

Chris, 2026-11-03: "clean and crisp and premium: light and dark mode with very slimline
borders, clean and clear iconography, crisp typography, impressive micro animation."

- **Two themes, one token set.** CSS variables in the shadcn shape, `prefers-color-scheme`
  by default and a three-way switch in settings (system, light, dark). Light is warm paper, not
  pure white; dark is near-black with the same hue, not grey. One accent colour, used only for
  the "needs you" bar, the primary button, and the count chip. Everything else is neutral.
- **Hairlines.** Borders are 1px at low alpha on the foreground colour (`currentColor` at 8%
  light, 12% dark), 0.5px where the device renders it. No shadows except a 2-stop lift on a
  card while it is pressed. Radius 14px on cards, 20px on the composer, full on chips.
- **Type.** Two faces, already in the repo: **Geist** for the interface and your own messages
  (15px/22px, tracking -0.01em), **Newsreader** for Reeve's words (17px/25px, weight 400), so the
  assistant has a voice distinct from the chrome. Numbers tabular. Nothing bold above 600. If
  Newsreader-for-Reeve reads as precious in the first week, the fallback is Geist everywhere
  with Reeve at 16px; decide after living with it.
- **Icons.** Lucide, 1.5px stroke, 20px, never filled, never more than one per control.
  Search, settings, send, check, redo, chevron. That is the set.
- **Motion** with the `motion` library (React), every duration between 160 and 320ms, springs
  for movement, ease-out for opacity, all of it off under `prefers-reduced-motion`:
  - a new message rises 8px and fades in; your own message leaves the composer by sliding up
    into the thread while the composer clears, no success toast;
  - "on it" shows three dots breathing; when the result lands the card grows from the bubble
    (layout animation), never a pop;
  - pressing a button scales it to 0.97; Approve draws a check (SVG path, 240ms) and the card
    collapses to its one line with the content fading first and the height following;
  - the count chip rolls its digit vertically when it changes and fades out at zero;
  - the thread's scroll-to-bottom on open is instant, a jump never animates;
  - settings and search slide in as sheets with a backdrop that fades, dismissible by drag.
- **Density.** 16px gutters, 12px between messages of the same author, 20px when the author
  changes, 44px minimum tap targets, safe-area insets respected at the composer.

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
  brief, title "Today", a bubble in the thread.
- **E-12** The brief's prompt drops every mention of change requests and gains the vault's
  effort trackers (`~/vault/efforts/*.md`, status `doing`) as context, read by the bridge the
  evening before and stored alongside the brief's inputs.
- A `dispatched` action unclaimed for thirty minutes pushes "Reeve hasn't picked this up".
- iPhone shows no notification buttons; approval is one tap away in the app.

## 11. Build order

| Step | What | Done when |
|---|---|---|
| E0 | This document; first edition archived | `docs/` holds `spec.md` and `archive/` only. **Done 2026-11-03.** |
| E1 | Export change requests to the vault; migration 0019; retire the three functions, their secrets, the GitHub webhook, the `claude.yml` workflow, the Caddy route, the cron job; prune `packages/shared` | Stack healthy, `pnpm test` green, nothing references change requests. **Done 2026-11-03** (see §14). |
| E2 | The app as the thread (§5): `thread_events` view, new `screens/` and `components/`, libraries moved, light and dark tokens, motion, e2e for the acceptance in §5 | Deployed; Chris's checklist on the phone passes. **Built and deployed 2026-11-03** (see §14); the phone checklist is Chris's. |
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
- A notifications history, password reset (single user, sessions live long).
- A proposals ledger or second confirmation step: a mistake that a single Approve tap could not have prevented.

## 13. Decisions taken in this document

- `areas` keeps its table name; the product says "domain".
- The app is one thread (decided 2026-11-03, replacing an earlier two-destinations draft): no
  Today, no Due screen, no Work board, no Library tab; search filters the thread; decisions are
  cards inside it.
- Reeve changes itself through local branches and a sentence to the machine session, not
  through GitHub issues.
- Triage requests filing; the bridge files (the function cannot reach the vault).
- The first-edition `spec.md` was gitignored as personal content and now lives in the vault
  (`cards/canonical/reeve/spec-first-edition.md`). This edition names domains by their labels
  only and is tracked in the public repo; the detailed scopes stay in the vault's `CLAUDE.md`
  and the gitignored `areas.json`.

## 14. Deviations found while building

Written by the implementing sessions, one line each, newest first.

- E2 (2026-11-03): `notices` is a new table after all (§5 E-5 said "no new table"): the due digest, paused and stalled had no row anywhere, and abusing `agent_runs.error` for message text was worse. The realtime application (E-3c) is a targeted refetch of the changed message's view rows by `ref_id`, not a transform of the payload: the payload is a table row, the cache holds view rows. A `decomposed` card has one button, **Got it** (approve), where the table said none: without it the card never leaves review and counts against you forever. A Redo keeps only the latest note (`actions.feedback` is one column), so an earlier note disappears from the thread when a second Redo overwrites it. The proposal card shows the title and "Want me to?" rather than restating the title in the first person. The filed line is pinned a millisecond ahead of the earliest action (triage inserts the action before it logs its run). The bridge's `reeve` routing note still forbids editing application code: E3 relaxes it. Search is an inline bar under the header rather than a sheet; settings and the long-press menu are sheets.
- E1 (2026-11-03): `triage_corrections` and `triage_rates` were listed as candidates for review and kept, as §4 says; `reeve_capture_share` and `change_request_leadtime` went. The migration counted the vault-secret delete as a rewritten row, so `--yes` was needed (expected). The old Caddy webhook route carried the anon key in the file; it is gone with the route. The `api-landing` container has no admin API, so `caddy reload` fails; recreate the container instead. A stale git worktree at `.worktrees/work-board` (branch `work-board`) predates the second edition and was left alone. The `REEVE_AREA_ID` constant stays exported with a new comment; the reeve-domain Go now dispatches like any other domain, which is what §2 says, but the bridge's reeve routing note still forbids editing application code: E2/E3 should let it draft on a local branch. `ANTHROPIC_API_KEY` as a *repo* secret served only the retired `claude.yml`; removing it is Chris's (`gh secret delete` is blocked for the agent).
