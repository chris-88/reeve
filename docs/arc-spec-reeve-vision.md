# Reeve: The north star

Status: **Direction, not commitment.** This document commits *nothing* to build.
It names what Reeve is becoming, so every future spec can be judged against it.
Owner: Chris
Audience: every future spec session — the frame each new spec is measured against
Companion to: `docs/spec.md` (§9 end-state), `docs/arc-spec-attention-queue.md`
(the middle layer), `docs/arc-spec-phase-1.md` (commitments, Due, change
requests, briefs)

---

## 1. Why write this down

Reeve started as a capture tool — type a thought, get it filed. But the last
three specs have all been leaning the same direction without naming it: the
attention queue turns Reeve into "a chief-of-staff that comes to you when it
needs you"; `spec.md` §9 is "agents draft, Chris approves"; the `reeve` chip
already turns a thought into a filed, shipped change. Each spec found the same
grain independently.

This document names that grain, once, so future specs stop rediscovering it and
start pointing at it. It is a **compass, not a plan.** Its whole value is
keeping the earned, incremental work aimed the same way.

**The cost of writing a vision down, named honestly:** a vision doc can become a
wish-list that quietly licenses anticipatory building — the exact thing
`spec.md` §1 forbids. This one earns its place only if it *defers* relentlessly.
Everything below the pattern is a horizon, not a backlog. Nothing here is
approved by appearing here.

## 2. The one idea

> A single surface where I hold a conversation about anything in my life, and it
> becomes the right thing — a spec, a ticket, an email, a text, a calendar
> event, a task for me — with an assistant behind each area of my life.

Reduced to its mechanism:

**Conversation → the right artifact or action → for one area of life → with AI
doing the input and the output, so the only human job left is judgment.**

Three axes fall out of that sentence, and they are the axes every future feature
moves along:

| Axis | Today | The vision |
|---|---|---|
| **Input** | a single captured thought | a conversation you can think inside |
| **Output** | filed to an area; a GitHub issue for the `reeve` area | any artifact or action — spec, ticket, email, text, calendar, task, note |
| **Coverage** | one classifier over shared areas | an assistant per area, each with its own context and reach |

## 3. It is already partly here

This is the honest grounding, and the reason the vision is a *generalisation*
rather than a fantasy. Reeve already runs the pattern — narrowly — in shipped
code:

| Shipped / specced primitive | What it already does | Which axis it instantiates |
|---|---|---|
| Capture → triage → filed to an area (Phase 0) | a thought is understood and placed | Input + Coverage, single-shot |
| The `reeve` chip → issue → approve → filed → shipped (Phase 1) | a thought about the app becomes a tracked, shipped change | Output — one area, one artifact type |
| Daily brief (P1-F5/6) | the system surfaces what matters, unprompted | the assistant that comes to *you* |
| Commitments + Due (Phase 1) | obligations are extracted from thoughts and time-lensed | Output — actions with dates |
| "Needs you" attention queue (`arc-spec-attention-queue`, proposed) | agents draft, you approve/tweak/defer | the judgment gate |
| `spec.md` §9 (end-state) | the gate, automated — agents draft, Chris approves | the whole loop, closed |

Two honest caveats, so no future spec overclaims:

- **It is not yet a conversation.** Today's input is one captured thought, not a
  back-and-forth. The conversation is the deepening — already named as
  "conversation mode" in `arc-spec-attention-queue` §6 and `spec.md` §9.
- **The `reeve` chip is the only output integration that exists.** Everything
  else in the Output axis (email, text, calendar…) is horizon.

## 4. The shape it probably takes

A sketch of how the pieces compose — **a map to orient specs, not an
architecture to build.** Each box is earned separately, and several already
exist.

```
  conversation  ─▶  router  ─▶  per-area assistant  ─▶  approval gate  ─▶  output
  (think inside)   (which       (drafts the artifact    ("Needs you":    (spec, ticket,
                    artifact?     with the area's         approve /        email, text,
                    which area?)  context + reach)        tweak / defer)   calendar, task)
        ▲                                                      │
        └──────────────────  it comes back to you  ◀───────────┘
```

- The **router** is the hard, new part — deciding what a conversation should
  *become*. Everything else Reeve already has a version of.
- The **approval gate** is `arc-spec-attention-queue`'s "Needs you." It is the
  same gate whether the output is a PR or a calendar event.
- A **per-area assistant** is `areas` (already owner-scoped) grown from a
  classification target into an actor with context and tools — one assistant per
  area, sharing a common toolbelt (§6.3).

## 5. What this explicitly does not commit

Applying `spec.md` §1 to itself: **none of the horizon below is earned by
appearing in this document.** Each is earned by a specific observation, and each
belongs in its own spec when that observation arrives.

### Horizon — output integrations and area behaviours

| Ref | Candidate | Earned when… | Belongs in |
|---|---|---|---|
| H-1 | **Conversation mode** (multi-turn think-inside) | the single-shot capture demonstrably loses ideas that needed a second turn | grows from `arc-spec-attention-queue` AQ-2; full form in `spec.md` §9 |
| H-2 | **The router** (conversation → artifact type) | more than one output type exists to route *between* — until then there is nothing to choose | its own spec, once H-3+ give it targets |
| H-3 | **Email / text as an output** | a captured intent repeatedly *is* "send X to Y" and filing it is not enough | its own spec — carries an external integration and a send-authority decision |
| H-4 | **Calendar as an output** | commitments in Due are repeatedly re-entered by hand into a real calendar | its own spec (already named in `arc-spec-attention-queue` §6) |
| H-5 | **Per-area assistants** (an actor per area) | one shared classifier visibly can't serve two areas' different needs at once | its own spec — the biggest step; see open questions |
| H-6 | **Lists** (quotes, shopping, gifts) | list-shaped captures pile up and areas prove to be the wrong primitive for them | a "lists" spec (`arc-spec-attention-queue` §6) |
| H-7 | **Automated dispatch + return** | the manual Go/approve loop is proven and the hand-off shape has stabilised | `spec.md` §9 |

The order here is not a roadmap. It is a set of independent doors, each opened
by its own key. Two settled decisions (§6) constrain the horizon: H-3 and H-4
inherit **approve before every send**; H-5 inherits **one assistant per area,
shared toolbelt**.

## 6. Decisions taken

Four directional forks were put to Chris and answered. They are **directional
decisions — constraints and posture, not committed features.** Everything in §5
is still earned by observation; these only fix which way the walking goes.

1. **Single-user, permanently.** Reeve is for one person. A design constraint,
   not a limitation: it collapses identity, privacy, and the trust surface for
   outward actions to "your accounts, your tokens." The data layer stays
   `user_id`-scoped as it already is, so it is not technically irreversible —
   but nothing new is designed as if a second user is coming.
2. **Approve before every outward action.** When Reeve can act in the world —
   send an email or a text, write a calendar event — it does so **only** through
   the approval gate; nothing reaches an external service without an explicit
   approve. The gate *is* the authority model. Autonomous categories are earned
   later, one at a time, once their drafts have proven reliably right — never by
   default. A mistaken outward action is high-cost and usually irreversible.
3. **One assistant per area, sharing a common toolbelt.** An area is 1:1 with an
   assistant that carries that area's context, taxonomy, and connected accounts —
   "a personal assistant for each area of my life." The *capabilities* they use
   (draft, schedule, send) are shared, not rebuilt per area. This shapes H-5: an
   area grows from a classification bucket into an actor with context and reach.
4. **The middle is a queue, not a log.** Reeve surfaces only what needs a
   judgment ("Needs you"); history and reference live in Search, not a scrolling
   feed. An empty queue means caught up — success, not absence. This ratifies
   `arc-spec-attention-queue`'s direction and settles the question open since
   `docs/archive/ui-spec.md` §9.

## 7. What each existing spec owns (so this treads on none)

| Spec | Owns | This doc's relation |
|---|---|---|
| `spec.md` | Phase 0 + the §9 end-state | the north star *is* §9, generalised beyond code changes |
| `arc-spec-phase-1.md` | commitments, Due, change requests, briefs | shipped instances of axes Output + "comes to you" |
| `arc-spec-attention-queue.md` | the "Needs you" middle layer, conversation mode | owns the approval gate and H-1; this doc names why it matters |
| `arc-spec-skills-integration.md` | the dev-layer tooling that dogfoods this pattern | its companion — building Reeve the way Reeve works |

This document adds no requirements and no code. If a future spec cites it to
justify building something, that spec still has to show the *observation* that
earned the work. The north star tells you which way to walk; it never tells you
you have arrived.
