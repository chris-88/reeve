---
name: to-spec
description: Turn the current conversation into a Reeve arc-spec in the house style. No tracker, no interview — synthesis.
disable-model-invocation: true
---

# to-spec (Reeve)

Forked from the borrowed `to-spec`: Reeve's planning unit is a spec **file**, not
an issue tracker. Produce `docs/arc-spec-<slug>.md`, do not publish anywhere.

Synthesize what has already been discussed — do **not** re-interview.

## The house style (match it exactly)

- **Frontmatter:** `Status:` / `Owner:` / `Audience:` lines (add `Companion to:`
  / `Supersedes:` when relevant). A fresh spec is `Status: Proposed`; the
  `## 0. Implementation status` section is added only when it is built.
- A **"why this exists"** opening that states the problem honestly.
- **Numbered features** with stable IDs (`F1`, `AQ-3`, `SK-2`) and numbered
  requirements beneath them; **acceptance criteria as the completion gate**, not
  "the code is written."
- A **sequencing / build order** section with the reasoning behind the order.
- An explicit **deferred / out-of-scope table** — and per `spec.md` §1, every
  deferred item names **the specific observation that would earn it.**
- A **definition of done**.
- **Voice:** direct, opinionated, no hedging; give the reason a decision was
  made, not just the decision; tables for anything comparative; where a choice
  has a cost, name the cost.

## The rules that make a spec trustworthy

- **Verify every factual claim about the codebase before writing it down.** The
  implementing session picks the spec up cold and will trust line references and
  behavioural claims. Check them against the code.
- **Do not specify a feature the earning principle would defer.** Deferred work
  goes in the table with its earning observation, not in the body.
- Raise genuine uncertainty as an **open question**, not by resolving it in the
  spec.
- **This is a spec session. Do not offer to build it.** The spec is the
  deliverable. (`reeve-spec-house-style`, `spec-owner-not-implementer`.)

## Done when

`docs/arc-spec-<slug>.md` exists in the house style, every codebase claim in it
is verified, and deferred work carries its earning observation.
