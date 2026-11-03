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
| `arc-spec-phase-1.md` | 2026-11-03 (superseded) | Commitments, retrieval, the brief, the GitHub change-request loop (retired by the second edition) |
| `arc-spec-inbox-board.md` | 2026-11-03 (superseded) | Proposed board; replaced by the attention queue before it was built |
| `arc-spec-web-push.md` | 2026-11-03 | VAPID keys, subscriptions, the worker handlers, send-push |
| `arc-spec-pwa-hardening.md` | 2026-11-03 | Offline durability, the outbox, auth hardening, iOS lessons |
| `arc-spec-attention-queue.md` | 2026-11-03 (superseded) | Needs you, actions, Go, the Work board; the manual handoff the bridge replaced |
| `arc-spec-attention-queue-tickets.md` | 2026-11-03 | Ticket breakdown for the attention queue |
| `arc-spec-bridge.md` | 2026-11-03 | The bridge worker: claim, run, return, decompose, Redo note |
| `arc-spec-notifications.md` | 2026-11-03 | Deep links, badge, due reminders, the ask at Go, cache matchers |

**Second edition (2026-11-03).** Everything above was superseded at once by `docs/spec.md`,
which restates Reeve from the bridge model. The first-edition product spec was personal content
and never tracked here; it is preserved in the vault.
