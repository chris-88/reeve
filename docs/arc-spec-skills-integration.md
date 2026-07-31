# Reeve: Skills & subagents integration

Status: **Built (dev-layer skills & subagents), 2026-07-31.** Runtime firing of
each skill is verified by use, not CI — there is no CI for `.claude/`.
Owner: Chris
Audience: implementing session picking this up cold
Companion to: `docs/arc-spec-reeve-vision.md` (the north star this dogfoods),
`CLAUDE.md` (the operational handoff it plugs into), `skills/` (the source of
truth for the skill library), `docs/skills/` (the human-readable guide)

---

## 0. Implementation status

**Built 2026-07-31**, on branch `skills-integration`. `.claude/` did not exist
before; the dev-layer structure is now in place.

**What was built**

- **SK-1** — `.claude/skills/` created. Six borrowed in-set skills symlinked to
  the (gitignored) `skills/` library: `grill-with-docs`, `grill-me`, `grilling`,
  `handoff`, `diagnosing-bugs`, `tdd`. The symlinks are gitignored by name, so
  they are local-only, as decided (§9.3).
- **SK-2** — `reeve-migrate` and `reeve-ship` authored as native, committed,
  user-invoked skills, each encoding the matching `CLAUDE.md` "cost hours"
  lessons as gated steps.
- **SK-3** — `to-spec`, `to-tickets`, `implement` forked as committed files,
  adapted to Reeve (house-style spec file; local tickets; branch-first /
  commit-when-asked / built-in review). No `CONTEXT.md`/`docs/adr`/`docs/agents`
  created.
- **SK-4** — **no new files.** `code-review` uses the built-in `/code-review`;
  research uses the built-in `deep-research`. Standing up duplicates would have
  violated the non-duplication rule (§6).
- **SK-5** — `.claude/agents/reeve-router.md`: the prototype route-and-draft
  assistant, preloading `to-spec`/`to-tickets`.

**What the spec did not predict**

- **Symlinked skills keep their source invocation mode.** SK-1 wanted everything
  user-invoked (zero context cost), but a symlink cannot change frontmatter
  without editing the shared source (and Codex). So `grilling` stays
  model-invocable — it *must* be, since `grill-with-docs`/`grill-me` call it —
  and `tdd`/`diagnosing-bugs` keep their model-invocable default (a small,
  deliberate context cost, useful for auto-fire). Only the forks diverge, and
  they are all user-invoked.
- **A `.gitignore` anchor bug.** `skills/` without a leading slash also matched
  `.claude/skills/`, ignoring the native skills. Fixed to `/skills/`
  (root-anchored); borrowed symlinks are ignored by explicit name.
- **SK-4 collapsed to zero files** — the built-ins already cover it.

**Not verified** (no CI for `.claude/`): each skill actually firing when typed,
and the `reeve-router` prototype's real behaviour. Verified by use.

## 1. Why this exists

There is a 41-skill cross-platform library sitting in `skills/` at the repo
root. **None of it is callable.** Claude Code discovers skills only from
`.claude/skills/`, `~/.claude/skills/`, and plugins — a plain `skills/`
directory is inert. So today an agent can *read* a SKILL.md but cannot *invoke*
one, and nothing is wired to fire on its own.

This spec does two things, and they are the same move at two altitudes:

1. **Make building Reeve best-in-class** by making the right subset of skills
   actually usable, adapted to how Reeve really works.
2. **Dogfood the product's core pattern** — conversation → the right artifact →
   drafted for approval — at the dev layer, where we can feel it before it goes
   in the PWA (`arc-spec-reeve-vision` §2).

The skills are borrowed from someone Chris respects. This spec keeps the *idea*
and adapts the specifics to Reeve; it does not adopt the library wholesale.

## 2. Two layers — keep them distinct

The vision's pattern shows up in two places that share a shape but not a
runtime. Conflating them is the main risk this spec exists to prevent.

| | **Dev layer** (this spec) | **Product layer** (`arc-spec-reeve-vision`) |
|---|---|---|
| Runs in | Claude Code, on Chris's machine | the PWA + Supabase Edge Functions |
| Serves | building Reeve | Chris's life |
| "Assistant" is | a `.claude/agents/` subagent | an Edge Function / agent run |
| "Skill" is | a `.claude/skills/` SKILL.md | product code |
| Relationship | a **working prototype** of the pattern | the thing being prototyped |

**Rule:** nothing in `.claude/` ever runs in the PWA. When SK-5 stands up an
"assistant," it is a dogfood — a way to learn the product router's shape — not a
component of the product.

## 3. The mechanics that constrain the design (verified)

Confirmed against current Claude Code docs. Where a detail is version-gated it
is flagged — the implementing session must confirm against the installed
version before relying on it.

- **Discovery.** Only `.claude/skills/<name>/SKILL.md` (project, searched up to
  repo root), `~/.claude/skills/`, plugin-bundled skills, and `--add-dir` paths.
  A repo-root `skills/` is **not** discovered. Precedence on name collision:
  Enterprise > Personal > Project > Bundled.
- **Invocation control (SKILL.md frontmatter).**
  - `disable-model-invocation: true` → **user-invocable only**; its description
    is **not** loaded into context (zero context cost until typed).
  - `user-invocable: false` → **model-invocable only**; hidden from the `/`
    menu.
  - Default (a `description`, neither flag) → both; the description sits in
    context every turn. **Context is not free — model-invocable skills tax the
    window.**
- **How a skill runs.** Inline in the current context by default. With
  `context: fork` it runs in an **isolated forked subagent** (`agent:` selects
  the subagent type; `background: true` is the default). *`context: fork`/`background`
  are recent (≈ v2.1.218+) — confirm before depending on them; fall back to a
  `.claude/agents/` definition for fan-out if unavailable.*
- **Subagents.** Defined in `.claude/agents/<name>.md` (frontmatter:
  `name`, `description`, `tools`, `model`, optional `skills:` to preload,
  `isolation: worktree`, etc.). Auto-delegated by `description`, or invoked
  explicitly. They **can** use and preload skills. They **cannot** hold an
  interactive back-and-forth with the human — `AskUserQuestion` is removed from
  every subagent. They run to completion and return one result.
- **Symlinks.** Followed and de-duplicated. A single source of truth in
  `skills/` symlinked into `.claude/skills/` is supported. (Claude Code reads
  the SKILL.md; the `agents/openai.yaml` beside it is ignored, harmlessly.)
- **Scope.** Project `.claude/skills/` is committed and shared (and available in
  cloud/Cowork runs); personal `~/.claude/skills/` follows you across projects
  but is not available remotely. Per decision §9.3, only the Reeve-native and
  forked skills are committed here; the borrowed symlinks are gitignored, so they
  are absent from cloud runs by design.

## 4. The rule that places every skill

**Interactive → an inline, user-invoked skill (main loop). Autonomous fan-out →
a subagent.**

It follows directly from §3: a subagent cannot ask you anything, so any skill
whose whole job is to interview you, confirm a seam, or put a decision to you
*must* stay in the main loop. Everything that runs to a result without you wants
the isolation and parallelism of a subagent.

| Skill(s) | Home | Why |
|---|---|---|
| `grilling`, `grill-with-docs`, `grill-me`, `to-spec`, `to-tickets`, `implement`, `handoff`, `diagnosing-bugs`, `tdd` | `.claude/skills/`, **user-invoked, inline** | they interview you, confirm seams, or you drive them while watching |
| `research` | forked skill (`context: fork`, background) **or** `.claude/agents/researcher.md` | reads to completion, no input needed — the definition of a subagent |
| `code-review` | fan-out — but see SK-3 (name collision with the built-in) | already designed to run parallel reviewers |
| `reeve-migrate`, `reeve-ship` (SK-2) | `.claude/skills/`, **user-invoked, inline** | they touch the DB/CI with your credentials while you watch |

## 5. Features

### SK-1 — Promote the earned subset into `.claude/skills/`

Create `.claude/skills/` and populate it with **symlinks** to the source dirs in
`skills/`, so `skills/` stays the single source of truth. Make each symlinked
skill **user-invoked** (`disable-model-invocation: true`) unless there is a
reason to pay context for auto-invocation — most should cost nothing until
typed.

The criterion is §4 (interactive + Reeve-relevant → in). A concrete starting
set — refine with use, do not treat as fixed:

| In (symlink) | Adapt first (SK-3) | Leave in the library (not Reeve's set) |
|---|---|---|
| `grill-with-docs`, `grill-me`, `grilling`, `handoff`, `diagnosing-bugs`, `tdd` | `to-spec`, `to-tickets`, `implement`, `code-review`, `research` | `scaffold-exercises`, `migrate-to-shoehorn`, `teach`, `edit-article`, `obsidian-vault`, `triage`, `setup-matt-pocock-skills`, `wayfinder`, `improve-codebase-architecture`, `writing-*` |

**Cost named:** symlinks mean editing a skill edits it for every context that
uses `skills/`, including Codex. That is the point (one source of truth), but a
Reeve-specific tweak to a shared skill leaks. Where a skill needs to diverge for
Reeve, fork it into a real file under `.claude/skills/` instead of symlinking
(SK-3 does exactly this for the adapted ones).

**Committed vs local (decision §9.3).** `skills/` and `docs/skills/` are
gitignored, so the borrowed skills — and the symlinks that point at them — stay
local-only and will dangle in a fresh clone or a cloud run. The Reeve-native
skills (`reeve-migrate`, `reeve-ship`) and the SK-3 forks are real, committed
files, so they survive everywhere. `.gitignore` therefore ignores the borrowed
symlinks under `.claude/skills/` while tracking the native and forked files.

**Acceptance.** `.claude/skills/` exists; the in-set skills appear in the `/`
menu and run; none of them loads a description into context unless deliberately
model-invocable; `skills/` remains the source for the symlinked ones.

### SK-2 — Author the two Reeve-native ops skills

These do not exist in the library. They encode the most expensive knowledge in
`CLAUDE.md`'s "Things that cost hours" as **gated procedures**, because a
passive reference read at session start did not prevent the failures — a
checklist at the moment of doing would have.

- **`reeve-migrate`** — the safe-migration procedure. Gates the known traps:
  `pnpm db:status` before naming a migration (duplicate numbers apply silently);
  never edit an applied migration (SHA-checked); `--dry-run`, and `--yes` only
  for a row-rewriting migration; **call a function after creating it** (plpgsql
  is not parsed at creation); the `pg_trgm` GUC load-order trick; and **check
  what is actually in a table before a migration infers anything from it** —
  the rule that a lost `corrected_area_id` was paid for.
- **`reeve-ship`** — the close-out procedure: `pnpm typecheck && lint && test`,
  then **push once and watch the run** (the `workflow_run` / `cancel-in-progress`
  trap eats a deploy on stacked commits), then the deploy — including
  `--no-verify-jwt` for `github-webhook` and the function-secret setup. It is
  `CLAUDE.md`'s "Before you finish" as something you can run.

Both are user-invoked and inline (§4). Detailed step design lives in each
SKILL.md when built; this spec fixes their responsibility and their gates.

**Acceptance.** Each skill, followed on a real task, refuses or warns at the
specific failure it names (e.g. `reeve-migrate` stops a same-number migration;
`reeve-ship` refuses to stack a second push before the first run is watched).

### SK-3 — Adapt borrowed skills to Reeve's docs; build no parallel doc system

Several borrowed skills assume machinery Reeve does not have: an issue tracker
for dev planning, a `CONTEXT.md` glossary, `docs/adr/`, `docs/agents/`. **Reeve
has none of these, and should not grow them to satisfy the tooling.** Its
planning unit is the spec file; its domain model and decisions already live in
`CLAUDE.md` and the `docs/arc-spec-*.md` files — `docs/archive/README.md` states
outright that the specs *are* the record of *why*.

The decision, and its reason:

| Borrowed assumption | Reeve reality | Resolution |
|---|---|---|
| `to-spec` publishes to an issue tracker | specs are `docs/arc-spec-*.md` in a fixed house style (`reeve-spec-house-style`), status tracked inside them | fork `to-spec` to write that artifact; no tracker |
| `implement` "commits to the current branch" | *branch first if on main; commit only when asked* (`CLAUDE.md`) | fork `implement` to obey Reeve's git rules |
| `code-review` reads `docs/agents/issue-tracker.md`; clashes by name with the built-in `/code-review` (+ `/code-review ultra`) | that file does not exist; the built-in is the review path | **prefer the built-in.** Do not symlink the library `code-review` under the same name. If its two-axis form is wanted, fork it under a distinct name and point its Spec axis at `CLAUDE.md` + the originating `arc-spec-*.md` |
| `research` overlaps the global `deep-research` skill | both write cited findings | pick one for Reeve; note it, don't run both by reflex |
| `setup-matt-pocock-skills` scaffolds tracker + labels + `CONTEXT.md`/ADR | Reeve uses `CLAUDE.md` + specs | do not run it; or fork it to Reeve's real layout |

**Explicitly not built:** `CONTEXT.md`, `docs/adr/`, `docs/agents/`. Creating
them would stand up a second source of truth beside `CLAUDE.md` and the specs,
which then drift — the opposite of best-in-class. Best-in-class here is
**one source of truth, and tooling adapted to the project, not the project bent
to generic tooling.**

**Acceptance.** No adapted skill references a non-existent Reeve file; `to-spec`
produces a house-style `arc-spec-*.md`; `implement` never commits on `main` or
without being asked; no `CONTEXT.md`/`docs/adr`/`docs/agents` is created.

### SK-4 — The fan-out subagents

Stand up the two autonomous, isolated jobs from §4:

- **`research`** — as a forked skill (`context: fork`, background) if the
  installed version supports it, else `.claude/agents/researcher.md`. Reads
  primary sources to completion, writes one cited Markdown file, returns.
- **`code-review`** — the parallel-reviewer job. Per SK-3, prefer the built-in
  `/code-review`; only stand up a subagent form if the two-axis variant is
  forked under a new name.

**Acceptance.** `research` runs without user turns and returns a cited file; the
review path is a single, un-collided choice (built-in, or a distinctly-named
fork).

### SK-5 — The prototype area-assistant (the dogfood)

One deliberate experiment: a `.claude/agents/` subagent that **feels the
product's conversation → draft → approve loop at the dev layer.** Chosen because
the constraint from §3 — a subagent cannot talk to you — is not a limitation
here; it *is* the product's shape. It forces "agents draft, Chris approves"
(`spec.md` §9, `arc-spec-attention-queue`).

**Definition.** `.claude/agents/reeve-router.md` (name TBD). Given a captured
idea or conversation transcript about building Reeve, it runs autonomously and
returns:

- the artifact it thinks the idea should **become** — a spec, a set of tickets,
  a note, or "not ready" — the H-2 router decision from the vision, at the dev
  layer;
- a **draft** of that artifact — it drafts by invoking the `to-spec` /
  `to-tickets` skills (decision §9.2: route *and* draft), so no new drafting
  logic is built;
- **why**, and a confidence.

The main loop presents that to Chris to approve, tweak, or reject — the same gate
the attention queue uses. It is scoped to the one "area" the dev layer has (the
Reeve product), so it needs no access to personal life data.

**This is a prototype — mark it as such.** Its value is *learning*, not output:
what inputs does a router actually need, what does a good "what should this
become" decision look like, where does it get the artifact-type wrong. That
learning feeds the product router (vision H-2) and per-area assistants (H-5); it
does not itself graduate into the PWA.

**Acceptance.** Given a real Reeve idea, the subagent returns a typed
recommendation + a usable draft + its reasoning, autonomously; the main loop can
approve/tweak/reject it; and the run produces a written note of what it taught us
about the router's inputs and failure modes.

## 6. What best-in-class means here (non-goals)

- **One source of truth.** `skills/` for the library, `CLAUDE.md` + specs for
  Reeve's knowledge. No parallel doc systems (SK-3).
- **Earned artifacts only.** Skills, subagents, and docs are added when a need
  is observed — the same `spec.md` §1 rule, applied to tooling. This spec adds
  two native skills and one prototype because each has paid-in evidence; it does
  not port the library wholesale.
- **Adapt the tooling to the project.** Not the reverse.

## 7. Deferred — with the observation that earns each

| Item | Earned when… | Where it belongs |
|---|---|---|
| More native skills (e.g. a classifier-tuning skill over `triage:report` + re-filing signal) | hand-editing `classifier_hint`s from re-filing data becomes a recurring chore | its own skill; touches the product mission |
| A close-out/`handoff`-discipline skill for the "update spec status + CLAUDE.md" ritual | sessions start skipping it and drift creeps in | `.claude/skills/` |
| More subagents beyond SK-4/SK-5 | a concrete parallel fan-out task appears (e.g. audit every RLS policy at once) | `.claude/agents/` |
| Porting the rest of the library | a left-behind skill is reached for repeatedly | SK-1's set grows |
| Per-area **product** assistants | the product needs them | `arc-spec-reeve-vision` H-5 — the product layer, not here |

## 8. Build order

1. **SK-1** — `.claude/skills/` + the symlinked in-set. Nothing else is callable
   without it. Immediately makes the interactive skills usable.
2. **SK-3** — fork and adapt `to-spec`, `to-tickets`, `implement`; settle the
   `code-review`/`research` collisions. Do before leaning on them.
3. **SK-2** — author `reeve-migrate`, `reeve-ship`. The highest-value adds;
   independent of the borrowed skills.
4. **SK-4** — the fan-out subagents (or confirm the built-ins suffice).
5. **SK-5** — the prototype assistant. Last, because it exercises everything
   above and its whole purpose is to learn from them.

## 9. Decisions taken

Three forks were put to Chris and answered.

1. **Mostly symlink, fork on divergence.** SK-1 symlinks the in-set to `skills/`
   for one source of truth; only the SK-3-adapted skills (`to-spec`,
   `to-tickets`, `implement`, the `code-review`/`research` fixes) and the native
   `reeve-migrate`/`reeve-ship` are real files. Drift is confined to the few that
   must diverge for Reeve.
2. **The prototype assistant routes *and* drafts.** SK-5 decides the artifact
   type and drafts it by invoking the existing `to-spec`/`to-tickets` skills,
   returning the whole thing for approval — the truest end-to-end dogfood, and no
   new drafting logic is built.
3. **The library stays in the repo, gitignored.** `skills/` and `docs/skills/`
   are gitignored (like `docs/spec.md` and `areas.json`), so the borrowed and
   personal skills never go public. **Consequence:** the borrowed skills
   symlinked into `.claude/skills/` are **local-only** and will dangle in a fresh
   clone or a cloud run; the Reeve-native and forked skills are **real, committed
   files**, so they survive everywhere. `.gitignore` gains `skills/` and
   `docs/skills/`, and ignores the borrowed symlinks under `.claude/skills/`
   while tracking the native/forked files.

## 10. Definition of done

- `.claude/skills/` exists; the in-set skills are invocable; `skills/` remains
  the source of truth for symlinked ones, and is gitignored — the borrowed
  symlinks are local-only, the native and forked skills committed.
- `reeve-migrate` and `reeve-ship` exist and gate their named failures.
- The adapted skills reference only real Reeve files; no `CONTEXT.md`/`docs/adr`/
  `docs/agents` was created; the `code-review` collision is resolved.
- `research` runs as a subagent; the review path is un-collided.
- The SK-5 prototype returns a typed recommendation + draft for approval, and
  leaves a written note of what it taught us.
- This spec's status section is updated at completion (per `CLAUDE.md`),
  recording anything the spec did not predict.
