# Archived specs

A spec moves here when **every ticket in it is done and deployed, and nothing
in it is outstanding** — no deferred item, no open question that still gates
work. A spec with a P2 tier left, or a feature parked pending a decision, stays
in `docs/`.

These are not dead. They are the record of *why* the code is the way it is —
the reasoning behind a decision usually outlives the ticket that carried it.
Read one when you want to know why something was built as it was; do not pick
work from one.

Each carries a `## 0. Implementation status` section written at the point of
completion, including anything found during implementation that the spec did
not predict. That section is the honest part — it is where the document admits
what it got wrong.

| Spec | Completed | What it covered |
|---|---|---|
| `ui-spec.md` | 2026-07-21 | 20 tickets: contrast, focus, offline state, the minimalism edit, drawer-vs-dialog |

Its §9 open questions — the greeting, sign-out/delete/archive, and whether the
Inbox is a log or a queue — were **not** resolved by that work. They belong to
Chris and are tracked in the root `CLAUDE.md`, not here.
