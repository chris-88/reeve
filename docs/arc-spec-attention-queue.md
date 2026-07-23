# Reeve: The attention queue

Status: **Built — AQ-1…AQ-6 on branch `attention-queue`.** Manual dispatch/
return only (automation is `spec.md` §9); two follow-ups flagged in §0.
Owner: Chris
Audience: implementing session picking this up cold
Supersedes: the "Inbox → Board" draft (kanban middle layer), replaced after the
design review in §1.
Companion to: `docs/spec.md` (§9 end-state), `docs/arc-spec-phase-1.md`
(commitments, Due, change requests, briefs).

---

## 0. Implementation status

Built in an isolated worktree on branch `attention-queue`, from `main` at
`a3848b9`. Every factual claim in this document was checked against the code
before it was implemented; the two corrections that needed making are below.

| | Feature | Status |
|---|---|---|
| P0 | **B-1** PWA nav gap (dvh) | ✅ Done — device check outstanding |
| P0 | **B-2** Mobile type scale | ✅ Done |
| P1 | **AQ-1** `actions` schema + soft-delete | ✅ Done (migration `0014`) |
| P1 | **AQ-2** The "Needs you" stream | ✅ Done — replaces the Inbox tab |
| P1 | **AQ-3** AI-proposed order + producer | ✅ Done — triage deployed |
| P1 | **AQ-4** The "Go" handoff | ✅ Done — reeve-routing flagged below |
| P1 | **AQ-5** The result loop | ✅ Scaffold — manual; §9 automates |
| P1 | **AQ-6** Search + archive | ✅ Done |

### Verified
- 102 unit tests (incl. `actions` RLS, `orderActions`, `assembleBrief`) and 7
  end-to-end tests pass on Chromium. The e2e capture test confirms the producer
  end to end: a dictated thought with a commitment becomes a proposed action
  visible in "Needs you".
- `pnpm build` passes the secret scan; the bundle is smaller than the board
  draft's (no drag library).
- The migration is applied and the triage function is deployed to the shared
  project (see the handoff caveats).

### Three defects this spec did not predict
1. **The producer would have blocked a filed capture.** Placed before `done`
   and throwing — the pattern `writeCommitments` uses — a producer error would
   have put a durable, filed thought back in the retry queue, the exact failure
   the whole system exists to avoid. It is now *after* `done` and non-fatal: a
   missing action is recoverable, a lost capture is not.
2. **The area foreign key.** The spec's SQL wrote `area_id text references
   areas(id)`; that predates areas-ownership (0003). `actions` uses the
   composite `(user_id, area_id) references areas(owner_id, id)`, like captures
   and commitments, so an action cannot carry someone else's area.
3. **The test runner could not import an app module.** The app uses the `@/`
   alias everywhere; the vitest config did not define it, so `orderActions`
   (whose module pulls in the supabase client) was untestable until the alias
   was added.

### Gaps left open — earn or build these next
- **Reeve-area actions use the generic brief, not the change-request pipeline.**
  AQ-4 asks a `reeve` action to route through the existing change-request
  handoff. The generic brief works for every area today; the reeve
  specialisation is wired but deferred.
- **Dispatch and return are manual.** The loop is complete but hand-driven —
  Go copies a brief to the clipboard; a result is pasted back by hand. The
  automation is `spec.md` §9.
- **The Inbox tab's F11 review UI lost its home.** Retiring the Inbox took
  Developer 2's `ReeveChangeRequests` (the Phase-1 F11 change-request review UI)
  off the nav. `Inbox.tsx` and `ReeveChangeRequests.tsx` are kept in the tree,
  not deleted — re-homing reeve change-request review into the "Needs you"
  stream is the natural continuation of the AQ-4 reeve-routing above.
- **Action decisions are online-first, not offline-durable.** Unlike a capture
  or a commitment edit, a Go/decline/approve is not queued through the outbox.
  A follow-up if deciding with no signal turns out to matter.
- **B-1 needs a device.** The nav-gap fix cannot be reproduced in the harness;
  it needs the installed iPhone PWA.

---

## 1. Where this came from, and the pivot

Chris raised a set of FE items by capturing them under the `reeve` area, and a
design conversation followed. An earlier version of this spec answered the
"kanban board of my notes" request literally: it put a **Trello-style board** in
the middle of the app — cards, columns, drag-to-prioritise.

Chris then made the observation that reshaped the whole thing:

> "This is basically a Trello middle layer with AI-assisted ticket input and an
> AI-only output. Is there a better way to design the UX?"

There is, and this document is it. The diagnosis: a board is a **workspace you
maintain** — clerical labour, arranging tickets for a robot — dropped between
the two things that are actually valuable (an AI that understands a fleeting
thought, and an AI that does the work). It fights everything Reeve is: fast,
fleeting, phone-first, one-handed, *don't distract from the thought*.

The reframe: **if the AI is good at the input and the output, the human's only
irreducible job is judgment.** So the middle should be optimised for
*approving*, not *organising*. The board becomes an **attention queue** — a
stream of decisions that need a human, ordered by the AI. Reeve stops being a
tool you operate and becomes a **chief-of-staff that comes to you when it needs
you.**

This is also the grain the rest of the system already follows: `spec.md` §9 is
*"agents draft, Chris approves"* (an approval gate, not a board); `change_requests`
is already a decision stream; `briefs` already generate "here's what matters";
and Chris himself captured "a conversation button to think through ideas." The
board was the odd one out.

### Decisions taken (with Chris, before writing)

- **Middle layer:** replace the board with an **attention queue** ("Needs you").
  AI proposes actions and their order; the human approves, tweaks, or defers.
- **Font:** keep Newsreader + Geist; fix mobile *size* only. Montserrat declined.
- **Delete:** archive (soft-delete), never hard delete.
- **Edit:** a capture's title and summary only; raw text stays immutable.
- **Inbox vs Due:** the old chronological Inbox is retired as a primary surface;
  Due stays as the time lens (see §3).

### Governing principle

**Reeve handles what it can and surfaces only what needs a human.** Every screen
either captures a thought or asks for a judgment. Nothing asks the user to do
logistics.

---

## 2. The model: Reeve proposes, you approve

The human makes three decisions nothing else can make:

1. **Is this worth doing?** — approve to start, or file as a note.
2. **Is it urgent?** — a light nudge on an order the AI already proposed.
3. **Did the agent do it right?** — approve the result, or send it back.

None of those needs columns or drag. They need a fast **approve / tweak / defer**
gesture. So the middle is a single stream — **"Needs you"** — of items awaiting
one of those decisions, newest judgment-needs surfaced first.

```
 Capture ─▶ AI triages
              │
      ┌───────┴────────┐
   just a note      actionable
      │                │  AI drafts a proposed action
      ▼                ▼
  (filed,        NEEDS YOU  ── "I read this as →
  reference)      decision     draft the invoice for Mary, due Fri."
                              [ Go ]  [ Tweak ]  [ Just a note ]
                                 │ Go
                                 ▼
                             dispatched to an agent  (manual for now)
                                 │  agent returns work
                                 ▼
                 NEEDS YOU  ── "Done. Here's the draft."
                  decision     [ Approve ]  [ Redo ]
                                 │ Approve
                                 ▼
                               (done)

 Commitments extracted along the way surface in DUE, by date.
 Everything captured stays findable in SEARCH, always.
```

Two decision moments — **approve-to-start** and **approve-the-result** — and
they look and behave the same, so there is one interaction to learn. **Priority
is proposed, not dragged:** the AI orders by due date and importance; if you
disagree you pin one thing to the top, you never maintain an order.

---

## 3. Information architecture

Three surfaces. Each answers one question; none is a workspace.

| Surface | The question it answers | Contents |
|---|---|---|
| **Write** | — (the capture surface, unchanged) | the text field |
| **Needs you** | "What needs a decision from me?" | proposed actions + agent results awaiting approval, AI-ordered |
| **Due** | "What do I owe, and when?" | commitments, by date (unchanged) |

- The old **Inbox** (a chronological log of every capture) is **retired as a
  tab.** Its review job moves to *Needs you*; its history job moves to **Search**
  (§5, AQ-6), off the primary nav. Empty *Needs you* = you're caught up, which
  is success, not absence.
- **Nav:** three tabs — Write · Needs you · Due. The in-flight dot moves to the
  *Needs you* icon and means "something is waiting on you."
- **Overview** — the one real thing a board gave — comes from **Due** (time) plus
  a quiet "in flight" line in *Needs you* showing what agents are currently
  working. A status list, not a workspace.

---

## 4. P0 — the two bugs

Unchanged by the pivot. Small, self-contained; ship first.

### B-1 — PWA bottom nav sits too high

**File:** `apps/web/src/styles.css` lines 101–105

Installed to the iOS home screen, the bottom nav floats up with an empty strip
beneath it. Hypothesis: `html, body, #root { height: 100% }` does not track the
`viewport-fit=cover` standalone viewport, so the flex column comes up short.

```css
html, body, #root { height: 100%; }
#root { height: 100dvh; }   /* tracks the installed-PWA viewport; 100% is the fallback */
```

Convert any stray `100vh` / `h-screen` while here. **Cannot be reproduced in the
harness** — Playwright here is Chromium, and the bug lives in iOS Safari
*standalone*. Make the change on the hypothesis; **Chris verifies on a real
installed PWA.** Next suspect if it persists: `background-attachment: fixed` on
`body` fighting the dynamic viewport.

### B-2 — Type is too large on mobile

**Files:** `Capture.tsx` (139, 116, 102), `Due.tsx` (144); `Inbox.tsx` line 129
applies only while that screen still exists — carry the same change into the new
*Needs you* header.

Responsive scale — smaller by default, current size restored at `sm:`.

| Site | Now | Becomes |
|---|---|---|
| Writing surface `Capture.tsx:139` | `!text-[1.7rem]` | `!text-[1.35rem] sm:!text-[1.7rem]` |
| **Departure-animation clone `Capture.tsx:116`** | `text-[1.7rem]` | `text-[1.35rem] sm:text-[1.7rem]` |
| Screen headings (`Capture:102`, `Due:144`, headers of new surfaces) | `text-[1.75rem]` | `text-[1.45rem] sm:text-[1.75rem]` |

The clone **must** match the textarea exactly or the save animation jumps size.
`1.35rem` ≈ 21.6px stays above the 16px focus-zoom floor. Do **not** change the
typeface (Montserrat declined).

---

## 5. P1 — building the attention queue

Six stages. Ship each to a working state before the next.

### AQ-1 — Foundation: the schema

**New migration** `0013_actions_and_archive.sql`.

Captures stay immutable records. An actionable capture is *promoted* into an
**action** — a thing Reeve proposes to do — carried through a decision
lifecycle. (Same promotion pattern as `commitments` and `change_requests`.)
Note there is **no `position` column**: priority is computed and proposed
(AQ-3), never hand-ordered. That is the whole simplification the pivot buys.

```sql
-- Soft-delete for the Search/reference view. Archiving is an UPDATE, already
-- permitted by captures_update; hard delete stays disallowed.
alter table captures add column archived_at timestamptz;

-- A proposed action Reeve can take on a capture's behalf.
create type action_status as enum (
  'proposed',    -- AI drafted it; awaiting Go / Tweak / decline   → in Needs you
  'dispatched',  -- Chris said Go; handed to an agent (manual for now)
  'review',      -- agent returned a result; awaiting Approve / Redo → in Needs you
  'done',        -- approved and complete
  'declined'     -- "just a note"; the capture stays filed as reference
);

create table actions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  capture_id    uuid not null references captures(id) on delete cascade,
  title         text not null,          -- what Reeve proposes to do; editable via Tweak
  brief         text,                   -- the drafted action / handoff an agent receives
  status        action_status not null default 'proposed',
  area_id       text references areas(id),
  pinned_at     timestamptz,            -- the "do next" nudge (AQ-3); null = AI order
  result        text,                   -- what the agent returned, awaiting approval
  dispatched_at timestamptz,
  decided_at    timestamptz,            -- when done or declined
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Needs you = the two states that require a human.
create index actions_needs_you on actions (user_id, status)
  where archived_at is null and status in ('proposed','review');

alter table actions enable row level security;
create policy actions_select on actions for select to authenticated
  using (user_id = (select auth.uid()));
create policy actions_insert on actions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy actions_update on actions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No delete policy — an action is archived, never deleted.

alter publication supabase_realtime add table actions;
```

**Shared types.** Add `Action` and `ActionStatus` to `packages/shared`,
mirroring `Commitment`.

### AQ-2 — The "Needs you" stream

**New:** `apps/web/src/screens/NeedsYou.tsx` (replaces the Inbox tab). Reuses the
existing detail sheet (`CaptureDetail` / `ResponsiveSheet`).

- **Membership.** `actions` where `archived_at is null` and `status in
  ('proposed','review')`, AI-ordered (AQ-3). Realtime-subscribed so items leave
  the moment they're decided on another device. Pending/failed *captures* still
  surface at the top exactly as they do today, until they finish triaging.
- **A proposed action** (`status='proposed'`) shows the AI's read of the
  capture — its `title`/`brief`, area colour, and any due date — with three
  actions, reachable by swipe or in the sheet:
  - **Go** → dispatch (AQ-4): `status='dispatched'`, `dispatched_at=now()`.
  - **Tweak** → edit `title`/`brief`, then Go. (This is also where a capture's
    own title/summary edit lives — the "edit notes" ask.)
  - **Just a note** → `status='declined'`; the capture remains filed as
    reference. Fire an **Undo** toast; the action feels weightless.
- **A result** (`status='review'`) shows what the agent returned, with **Approve**
  (`done`) or **Redo** (back to `dispatched` with a note). Same visual language
  as a proposed action — one interaction, two uses.
- **Archive** (the "delete a note" ask) lives in Search (AQ-6), not here — the
  stream is for decisions, not housekeeping.
- **Empty state:** "You're all caught up," not "nothing here."

**Acceptance.** An actionable capture appears as a proposed action; Go / Tweak /
Just-a-note each removes it from the stream; Undo restores it; a returned result
appears for approval; the stream reaches zero; editing title/brief persists.

### AQ-3 — AI-proposed priority

**Files:** `NeedsYou.tsx`, and the triage function (AQ-2's producer).

Order the stream so the top item is the right next decision. **v1**, computed:

1. Anything **pinned** (`pinned_at`), most recent pin first.
2. Then by the linked commitment's due date (overdue → soonest → none).
3. Then by recency.

A single **"Do next"** action sets `pinned_at` — the only manual lever, and it
overrides nothing structural. **v2** (later): the triage model scores importance
so the order reflects judgment, not just dates. Do not build v2's scoring now;
leave the ordering function a single call site so it can be swapped.

**Acceptance.** Overdue and pinned items lead; pinning re-orders instantly and
survives reload; no drag handles anywhere.

### AQ-4 — Send to agent (the "Go" handoff)

**Files:** `NeedsYou.tsx`, `packages/shared`, possibly `supabase/functions/`.

Manual for now, per Chris. "Go" assembles a **handoff brief** — the action
title, the linked capture's `raw_text`, the area and its context, any
commitment/date — stores it in `actions.brief`, and sets `status='dispatched'`.

- **v1 dispatch is manual:** present the brief for Chris to hand to a coding/work
  agent (copy-to-clipboard, or an "Open in…" affordance). No automated dispatch.
- **Reuse, don't fork.** Lift the brief-assembly from the `change_requests`
  (P1-F9) handoff. A `reeve`-area action routes through the *existing*
  change-request pipeline, not a parallel one.

**The automated version is `spec.md` §9** — *"agents draft, Chris approves."*
AQ-4 is that gate, driven by hand. Keep the brief shape close to what an agent
session consumes so automation is wiring, not redesign.

**Acceptance.** Go produces a complete, self-contained brief and moves the
action to *dispatched*; a `reeve` action goes through the change-request path.

### AQ-5 — The result loop

**Depends on real agents returning work — largely `spec.md` §9. Scaffold now,
finish later.**

When an agent finishes, its output lands on the action (`result`,
`status='review'`) and re-enters *Needs you* as an Approve/Redo decision (AQ-2).
For v1, with dispatch manual, there may be no automated return — so build the
states and the review UI, but the *automated* transition into `review` waits for
§9. Until then, Chris can mark a dispatched action done by hand.

**Acceptance.** The states and the review UI exist and are reachable; an action
can move dispatched → review → done; the automated entry into `review` is
explicitly out of scope and flagged as such in code.

### AQ-6 — Search (where the old log lives)

**New:** a lightweight all-captures view — a search field over `raw_text`/`title`
and a reverse-chronological list, archived items included, off the primary nav.
This is where a capture is found later and where a note is **archived** (sets
`archived_at`). It **must** exist before *Needs you* replaces the Inbox, or
retiring the chronological list will feel like data loss. If it can't land in
time, keep the old Inbox reachable (e.g. behind an icon) until it does.

**Acceptance.** Any past capture, archived or not, is findable without the old
Inbox; archiving hides a capture from Search's default view and is reversible.

---

## 6. P2 — deferred, with reasons

| Item | Why deferred | Where it belongs |
|---|---|---|
| **Screenshot upload** | Reintroduces Supabase Storage — a slice `spec.md` cut. | Its own spec |
| **More categories** (quotes, shopping, gifts) | Real life-areas are a seed edit (`areas.json`). But quotes / shopping / gifts are **lists** — a different primitive from an area. | A "lists" spec, if earned |
| **Calendar view** | Large; needs a data model and an external integration. | Its own spec |
| **Conversation mode** | *No longer far off.* "Needs you" is already a lightweight conversation — propose, tweak, approve. The captured "think through / challenge back" idea is its natural deepening: tap any item to talk it through. Build the queue first; let conversation grow from it. | Evolves from AQ-2; full version in `spec.md` §9 |

`spec.md`'s rule holds: **features are earned by observed need, not anticipated
need.**

---

## 7. Build order

1. **B-1, B-2** — the two bugs. Independent; ship first.
2. **AQ-1** — schema. Nothing below works without it.
3. **AQ-6** — Search, *or* keep the old Inbox reachable until it exists. Do this
   before AQ-2 retires the Inbox, so no history feels lost.
4. **AQ-2** — the *Needs you* stream (decisions, Tweak/edit, decline). Usable
   even before dispatch exists — Go can simply mark dispatched.
5. **AQ-3** — AI-proposed order + the "Do next" pin.
6. **AQ-4** — the Go handoff (manual dispatch).
7. **AQ-5** — the result loop (scaffold; automated return is §9).

Ship each to a working state before the next.

---

## 8. Open questions for Chris

1. **Who decides what's "actionable"?** AQ-2 assumes triage flags a capture as
   actionable (→ a proposed action) vs a plain note. The line is fuzzy — "quote
   I like" is a note, "ring the foreman" is an action, but many sit between. Get
   it wrong toward "action" and *Needs you* fills with noise; wrong toward "note"
   and things get missed. Start conservative (only clear commitments become
   actions) and loosen with observed behaviour.
2. **Does a proposed action absorb its commitment, or coexist with it in Due?**
   The same "ring the foreman Thursday" is both. Coexisting (each its own lens)
   is the assumption. If it reads as double-vision, have the action reference and
   hide its commitment from Due. Decide after living with it.
3. **What does an agent actually receive?** AQ-4 assembles a brief by hand. The
   first real handoff shows what's missing, and that shapes the §9 automation
   more than this spec can.

---

## 9. Sources & coverage

Every input that shaped this spec, and where it landed, so the implementing
session can trust the doc without re-reading the chat.

### From the `reeve` area (7 captures, read 2026-07-23)

| Capture | Disposition | Section |
|---|---|---|
| PWA bottom bar navigator positioning issue | Fix | **B-1** |
| Reeve font and mobile sizing — *size* | Fix | **B-2** |
| Reeve font and mobile sizing — *"Montserrat"* | **Declined** | §1, B-2 |
| Add screenshot upload feature | Deferred | §6 |
| Add categories and calendar — *categories* | Deferred; reframed as **lists** | §6 |
| Add categories and calendar — *calendar* | Deferred | §6 |
| Conversation button for thinking through ideas | Deferred, but **now aligned** with *Needs you* | §6, AQ-2 |
| "Test of the app" / "New app captures fleeting thoughts" | Excluded — not requests | — |

### From this conversation

| Ask / decision | Disposition | Section |
|---|---|---|
| Edit inbox notes | Built — title & summary, via Tweak | AQ-2 |
| Delete inbox notes | Built as **archive** | AQ-1, AQ-6 |
| "Kanban board of my notes" | **Reconsidered and replaced** by the attention queue | §1, §2 |
| Reorder into priority order | **AI-proposed order** + a "Do next" pin (no drag) | AQ-3 |
| Send a note to an agent | Built — Go handoff, manual | AQ-4 |
| Send directly, not via a board | The stream *is* the direct path — decide and Go in place | §2, AQ-2/4 |
| "Value of Inbox vs Due?" | Inbox retired; *Needs you* + Due + Search | §3 |
| "Is there a better way than a Trello middle?" | Yes — this whole rewrite | §1, §2 |
| Decisions: font / delete / edit | Applied | §1 |
| Decision: **middle = attention queue, not board** | Applied | §1, §2, §5 |

### Added by the spec (not requested)

| Addition | Why | Section |
|---|---|---|
| Search / archive view | History needs a home once the Inbox retires | AQ-6 |
| `actions` table + decision lifecycle | The means to a decision stream, promoted from captures like commitments/change_requests | AQ-1 |
| Result-approval loop | The output half of "agents draft, Chris approves" | AQ-5 |

### Deliberately not in this spec

- **The kanban board** — replaced (see §1). The prior "Inbox → Board" draft is
  obsolete; this document is the single current spec.
- **The earlier UI review (UI-1…20)** — a separate spec, already shipped;
  archived at `docs/archive/ui-spec.md`.
- **Hard delete** — excluded by decision; archive only.
- **Automated agent dispatch and return** — manual for now; automation is
  `spec.md` §9.
