# Reeve: Inbox → Board

Status: Proposed
Owner: Chris
Audience: implementing agent or developer picking this up cold
Companion to: `docs/spec.md` (§9 end-state), `docs/arc-spec-phase-1.md`
(commitments, Due, change requests). Where this document and `spec.md` disagree
on the shape of the Inbox, this one wins; `spec.md` §9 still governs the agent
end-state this builds toward.

---

## 1. Where this came from

Chris raised a set of FE items by capturing them under the `reeve` area — the
area whose whole purpose is *"feature requests, bugs, design ideas, and changes
Chris wants made to Reeve."* Reading them back, they are:

- **Bug** — in the installed PWA, the bottom nav sits too high, with a gap
  beneath it, "as if the Safari bar is still there."
- **Bug + request** — the type is too large on mobile; a request to switch to
  Montserrat.
- **Feature** — edit and delete notes in the inbox.
- **Feature** — turn the Inbox into a **kanban board** of cards, click into each
  for detail, reorder into priority order for an agent to work.
- **Feature** — a way to **send a note to an agent** once it has landed.
- **Feature** — screenshot upload; more categories (quotes, shopping, gifts);
  calendar; a "conversation" mode.
- Underneath all of it, a question: **what is the Inbox for, next to Due?**

The last question reshapes the app, so it is answered first (§2) and everything
else follows from it. `change_requests` (P1-F9, shipped) is the pipeline that
will eventually promote these same `reeve` captures into GitHub issues; this
document is the manual, generalised version of that loop for every area.

### Decisions already taken

Resolved with Chris before writing:

- **Font:** keep the Newsreader + Geist system. The complaint is *size*, not
  typeface — fix the mobile scale, do **not** adopt Montserrat.
- **Delete:** archive (soft-delete), not hard delete. Captures are the system
  of record and cascade into commitments and change requests.
- **Edit:** title and summary only. Raw text stays the immutable record.
- **Inbox vs Board:** the Inbox becomes a **triage queue that empties**;
  promoted items flow to a new **Board**; **Due** stays as the time lens.
- **Board form:** mobile-native (one priority-ordered list with a stage pill,
  drag to reorder) that becomes a true multi-column kanban at `sm:` and up.

### Governing principle

**One substrate, three lenses, and nothing on the capture screen that does not
help capture.** Every item is still a `capture`. The Inbox, the Board and Due
are three questions asked of that one pile — not three piles.

---

## 2. The information architecture

The Inbox today does two jobs: a *review surface* ("what just landed, did it
file right?") and a *permanent log* ("everything I ever captured"). That double
duty is why its value feels unclear next to Due. Chris's workflow — *capture →
process → review → prioritise → send to an agent* — is a pipeline, and a
pipeline needs the Inbox to be a **queue**, not a log.

| Surface | The question it answers | Ordered by | Empties? |
|---|---|---|---|
| **Inbox** | "What just landed that I haven't dealt with?" | recency | **Yes** — to zero |
| **Board** *(new)* | "What am I working, in what order, and where is it?" | **priority (drag)** + stage | no |
| **Due** *(unchanged)* | "What do I owe, and when?" | date | no |

Board and Due are **not** redundant: one is priority-ordered, one is
date-ordered, and they answer different questions. A card on the Board may carry
a due date; a commitment in Due may have no Board card. They are lenses, not
copies.

The flow:

```
   Capture ─▶ triaged ─▶ INBOX (review queue)
                            │
                 ┌──────────┴──────────┐
              archive               promote
                 │                     │
              (leaves)            BOARD (priority + stages)
                                       │
                                  send to agent
                                       │
                                     (worked)

   Commitments extracted along the way surface in DUE, by date.
```

The "everything forever" log the Inbox does today does not disappear — it moves
to a **search / archive** view off the main path (out of scope here; see §6).

---

## 3. Priorities

| | Meaning | Ship when |
|---|---|---|
| **P0** | The two raised bugs. Small, self-contained, no dependency on the reshape. | First, as one batch |
| **P1** | The Inbox → Board reshape. The substance of this document. | After P0, in stages |
| **P2** | Deferred features, each needing its own spec or a product call. | Not now |

Do P0 first — it is quick and unblocks nothing, so there is no reason to make it
wait behind the larger work.

---

## 4. P0 — the two bugs

### B-1 — PWA bottom nav sits too high

**File:** `apps/web/src/styles.css` lines 101–105

**Symptom.** Installed to the iOS home screen, the bottom nav floats up with an
empty strip beneath it.

**Root cause (hypothesis).** `html, body, #root { height: 100% }`. In an
installed PWA with `viewport-fit=cover`, `100%` does not reliably track the
standalone viewport, so the flex column comes up short and the nav sits above
the gap. The nav's `pb-safe` is already correct and is *not* the cause.

**Fix.**

```css
html, body, #root { height: 100%; }
#root { height: 100dvh; }   /* tracks the installed-PWA viewport; 100% is the fallback */
```

Grep for any stray `100vh` / `h-screen` and convert to `dvh` while here.

**Verification — read this.** This cannot be reproduced in the test harness:
Playwright here is Chromium, and the bug lives in iOS Safari *standalone*, which
Chromium cannot emulate (the e2e config already notes WebKit's system deps can't
be installed without root, and even WebKit-linux is not iOS-standalone). Make
the change on the hypothesis above; **Chris verifies on a real installed PWA.**
If the gap persists, the next suspect is `background-attachment: fixed` on
`body` interacting with the dynamic viewport — try moving the background to a
fixed full-screen pseudo-element.

---

### B-2 — Type is too large on mobile

**Files:** `apps/web/src/screens/Capture.tsx` (lines 139, 116, 102),
`apps/web/src/screens/Due.tsx` (144), `apps/web/src/screens/Inbox.tsx` (129)

**Symptom.** The writing surface (`1.7rem` ≈ 27px) and screen headings
(`1.75rem` ≈ 28px) are fixed across all widths and overshoot on a ~390px phone.
This is the "spend the boldness on the capture field" intent not scaling down.

**Fix.** A responsive scale — smaller by default, current size restored at
`sm:` so desktop keeps the drama.

| Site | Now | Becomes |
|---|---|---|
| Writing surface `Capture.tsx:139` | `!text-[1.7rem]` | `!text-[1.35rem] sm:!text-[1.7rem]` |
| **Departure-animation clone `Capture.tsx:116`** | `text-[1.7rem]` | `text-[1.35rem] sm:text-[1.7rem]` |
| Screen headings (`Capture:102`, `Due:144`, `Inbox:129`) | `text-[1.75rem]` | `text-[1.45rem] sm:text-[1.75rem]` |

The clone **must** match the textarea exactly, or the save animation will jump
size mid-flight. `1.35rem` ≈ 21.6px stays well above the 16px floor, so the
iOS focus-zoom guard in `styles.css` is not at risk. Leave the `1.05`–`1.35rem`
body/detail sizes alone — they read fine on mobile.

**Do not** touch the typeface. Montserrat was considered and declined (§1).

**Acceptance.** Screenshot at `devices["Pixel 7"]`: writing surface and headings
visibly smaller; at ≥ `sm:` unchanged. No layout shift; no focus-zoom on the
field.

---

## 5. P1 — the Inbox → Board reshape

Five stages. Build and ship each to a working state before the next; each is
usable on its own.

### RB-1 — Foundation: the schema

**New migration** `0013_tasks_and_archive.sql`.

The system's consistent pattern is that captures are *promoted* into typed rows
(`commitments`, `change_requests`). A Board card is the same idea generalised: a
**task** promoted from a capture, carrying a stage and a drag-order. Do **not**
mutate captures into work items — a capture stays an immutable record.

```sql
-- Soft-delete for the Inbox triage "archive" route. No new RLS: archiving is an
-- UPDATE, already permitted by captures_update. Hard delete stays disallowed.
alter table captures add column archived_at timestamptz;

-- A promoted unit of work. One per capture for v1 (many-to-one can come later,
-- as change_requests already models).
create type task_status as enum ('todo','sent','done','parked');

create table tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  capture_id  uuid not null references captures(id) on delete cascade,
  title       text not null,                    -- seeded from capture.title; editable
  status      task_status not null default 'todo',
  -- Fractional index so a card can be dropped between two others without
  -- renumbering the column. Smaller sorts first.
  position    double precision not null,
  area_id     text references areas(id),         -- carried from the capture, for colour
  -- Handoff, null until "send to agent" (RB-4).
  handoff_brief text,
  sent_at       timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index tasks_board on tasks (user_id, status, position)
  where archived_at is null;

alter table tasks enable row level security;
create policy tasks_select on tasks for select to authenticated
  using (user_id = (select auth.uid()));
create policy tasks_insert on tasks for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy tasks_update on tasks for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No delete policy — a task is archived, never deleted, like everything else.

alter publication supabase_realtime add table tasks;
```

**Inbox membership is derived, not stored** — no new state column on captures:

> A capture is in the Inbox when `status = 'done'` **and** `archived_at is null`
> **and** no `tasks` row references it.

Archiving sets `archived_at`; promoting inserts a `tasks` row. Either way the
capture leaves the queue, and both are reversible (clear `archived_at`; archive
the task). Add a covering index or a view if the `not exists (tasks)` check is
slow at scale.

**Zod / shared types.** Add a `Task` schema and `TaskStatus` to
`packages/shared`, mirroring `Commitment`.

---

### RB-2 — The Inbox becomes a triage queue

**Files:** `apps/web/src/screens/Inbox.tsx`, `apps/web/src/components/CaptureDetail.tsx`,
`apps/web/src/App.tsx`

The Inbox stops being a full history and becomes a review queue that empties.

- **Query change.** Filter to queue membership: `status = 'done'`,
  `archived_at is null`, no task. Keep the realtime subscription so items leave
  the moment they are routed on another device. Pending/failed captures still
  show at the top exactly as they do now.
- **Two routes per card**, reachable both by swipe (mobile) and in the detail
  sheet:
  - **Archive** → sets `archived_at`. Card leaves the queue. Fire an **Undo**
    toast (sonner) — the action is reversible and should feel weightless.
  - **Promote** → inserts a `tasks` row (`status='todo'`, `position` = end of
    the To-do lane, `title`/`area_id` from the capture). Card leaves the queue
    and appears on the Board. Confirm with a toast that offers **View** (jump to
    the Board) or **Undo**.
- **Edit (title & summary).** In the detail sheet, an edit toggle exposes
  `title` and `summary` as inputs, saved via `captures` update (RLS already
  allows it). Raw text stays read-only under "What you said". This is the "edit
  notes" ask; the "delete" ask is the Archive route above.
- **Empty state.** An empty Inbox is *success*, not absence — say so ("All
  caught up"), not "nothing here."
- **The nav in-flight dot** (`App.tsx`) already counts unsettled captures; leave
  it. Exclude `archived_at is not null` from that count so archiving never
  leaves a phantom dot.

**Acceptance.** Capturing a thought lands it in the Inbox; archiving or
promoting removes it; the Inbox reaches zero; Undo restores it; editing title
or summary persists and touches nothing else.

---

### RB-3 — The Board

**New:** `apps/web/src/screens/Board.tsx`, a nav entry, a `Board` icon.

The Board is the priority lens over `tasks`. Per the resolved decision it is
**mobile-native first, kanban on desktop.**

- **Nav.** Four tabs now: Write · Board · Due · Inbox. Order reflects the flow
  (write → work → owe → review). Confirm the four-tab bar still breathes on a
  small screen; if not, the Inbox — now transient — is the candidate to demote
  behind an icon, since you visit it to *clear* it, not to dwell.
- **Phone (`< sm`).** A single vertical list, ordered by `position`, grouped or
  filterable by `status`. Each card shows title, area colour, a **stage pill**,
  and a due date if its capture has a commitment. **Drag to reorder** (writes
  `position` as the midpoint of its new neighbours). Change stage by swipe or a
  segmented control on the card. Tap opens the same detail sheet.
- **Desktop (`≥ sm`).** A true multi-column kanban — a column per `task_status`
  — with drag both **within** a column (reorder → `position`) and **across**
  columns (restage → `status`). Same cards, same detail sheet.
- **Library.** Use a headless, accessible, touch-friendly DnD primitive
  (`@dnd-kit/*` is the current default for React 19 + touch). Do **not**
  hand-roll pointer maths. Honour `prefers-reduced-motion` — drag still works,
  transitions collapse.
- **Persistence.** `position` writes go through the outbox/optimistic path like
  commitment edits, so reordering works offline and reconciles.

**Acceptance.** Promoted items appear on the Board; dragging reorders and
survives reload; changing stage moves the card; the phone list and the desktop
kanban are the same data; drag is operable by keyboard and screen reader.

---

### RB-4 — Send to agent

**Files:** `apps/web/src/screens/Board.tsx`, `apps/web/src/components/`,
possibly `supabase/functions/`

"Send to an agent" — manual for now, per Chris. It is the same handoff
`change_requests` (P1-F9) already performs for `reeve` app-changes, generalised
to any task.

- A **Send to agent** action on a card assembles a **handoff brief**: the task
  title, the linked capture's `raw_text`, the area and its context, and any
  commitment/date. Store it in `tasks.handoff_brief`, set `status = 'sent'` and
  `sent_at = now()`.
- **Manual dispatch for v1:** present the assembled brief for Chris to hand to a
  coding/work agent (copy-to-clipboard, or a "Open in…" affordance). No
  automated dispatch yet — that is deliberately out of scope.
- **Reuse, don't fork.** Lift the brief-assembly shape from the change-request
  drafting/handoff code rather than writing a second one. For a `reeve`-area
  task specifically, "send to agent" should route through the *existing*
  `change_requests` path, not duplicate it.

**The automated version is not new scope to invent — it is `spec.md` §9**:
*"agents draft, Chris approves"* behind an approval gate, via Managed Agents.
RB-4 is that milestone pulled forward and driven by hand. Keep the manual brief
shape close to what an agent session would consume, so automating it later is
wiring, not redesign.

**Acceptance.** Sending a task produces a complete, self-contained brief,
transitions the card to *Sent*, and records when. A `reeve` task routes through
the change-request pipeline rather than a parallel one.

---

### RB-5 — Where the old log goes

The Inbox no longer holds history. Before shipping RB-2 widely, make sure
history is still reachable: a lightweight **search / all-captures** view
(archived included), off the primary nav. This can be minimal — a search field
over `raw_text`/`title` and a reverse-chronological list — but it must exist, or
archiving will feel like deletion. If it cannot land with RB-2, gate archive
behind a confirm until it does.

**Acceptance.** Any past capture, including archived ones, is findable without
the Inbox.

---

## 6. P2 — deferred, with reasons

Not built here. Recorded so they are neither lost nor smuggled in under "board
work."

| Item | Why deferred | Where it belongs |
|---|---|---|
| **Screenshot upload** | Reintroduces Supabase Storage (bucket, RLS, upload UI, triage reading an image) — a real slice `spec.md` deliberately cut. | Its own spec |
| **More categories** (quotes, shopping, gifts) | Real *life areas* are a seed-row edit (`areas.json` + `pnpm db:seed`), no code. But quotes / shopping / gifts are **lists** — a different primitive from an area, and stretching areas to cover them is the wrong shape. | A "lists" spec, if observed need earns it |
| **Calendar view** | Large; needs a data model and an external integration. | Its own spec |
| **Conversation mode** | Think-through / challenge-back is Phase 2 agent work, not FE. | `spec.md` §9 |

`spec.md`'s rule holds: **features are earned by observed need, not anticipated
need.** These are captured under `reeve` and will flow into the change-request
pipeline when they earn a slot.

---

## 7. Build order

1. **B-1, B-2** — the two bugs. Independent; parallelise. Ship first.
2. **RB-1** — schema. Nothing below works without it.
3. **RB-5** — the search/archive view, *or* a confirm gate on archive. Do this
   before RB-2 empties the Inbox, so no history feels lost.
4. **RB-2** — Inbox becomes a queue (archive, promote, edit). Usable alone even
   before the Board renders — promoted items simply wait.
5. **RB-3** — the Board.
6. **RB-4** — send to agent.

Ship each to a working state before starting the next.

---

## 8. Open questions for Chris

1. **Does a promoted task absorb its commitment, or coexist with it?** A capture
   like *"draft Mary's invoice by Friday"* can be both a Board task and a Due
   commitment. Coexisting (each its own lens) is the assumption above. If that
   feels like double-vision in use, the alternative is that promoting a
   capture *pulls* its commitment onto the card and hides it from Due — decide
   after living with it.
2. **Four tabs, or demote the Inbox?** Once the Inbox is transient, it may not
   deserve equal footing with Write/Board/Due. Worth watching whether you visit
   it to clear it (→ demote to an icon with the dot) or to dwell (→ keep).
3. **What does an agent actually receive?** RB-4 assembles a brief by hand. The
   first real handoff will show what context is missing — that answer shapes the
   automated §9 version more than this spec can.
