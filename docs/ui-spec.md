# Reeve: UI Remediation Spec

Status: **Complete.** All 20 tickets done, deployed, CI green.
Owner: Chris
Audience: implementing agent or developer picking this up cold
Companion to: `docs/spec.md` (the build spec). Where the two disagree, this
document wins on UI and `spec.md` wins on everything else.

---

## 0. Implementation status

Every claim in this document was verified against the running code before any
change was made. All of them held.

| | Ticket | Status |
|---|---|---|
| P0 | UI-1 Toast renders unstyled | ✅ |
| P0 | UI-2 Permanent focus ring on the writing surface | ✅ |
| P0 | UI-3 Indefinite "Syncing…" when offline | ✅ |
| P0 | UI-4 Muted text fails WCAG AA | ✅ |
| P1 | UI-5 Delete the word counter | ✅ |
| P1 | UI-6 Delete the confirmation toast | ✅ |
| P1 | UI-7 Button fills rather than fades | ✅ |
| P1 | UI-8 Collapse the area chips | ✅ |
| P1 | UI-9 Recompute greeting on resume | ✅ |
| P2 | UI-10 Drawer on mobile, Dialog on desktop | ✅ |
| P2 | UI-11 The thought departs | ✅ |
| P2 | UI-12 The Inbox tab acknowledges | ✅ |
| P3 | UI-13…UI-20 Housekeeping | ✅ (UI-15 needed no work) |

Build order was followed as written: P0 as one batch, then P3, then the
dependency-free P1 edits, then UI-11 before UI-6, then UI-12 and UI-10.

### Measured, not assumed

`--color-muted-dim` is **#83808a**, computed at **5.07:1** against
`--color-bg`, clearing AA for body text rather than only for large text. Every
other token was checked at the same time: `--color-text` 17.28:1,
`--color-muted` 6.81:1, `--color-danger` 6.47:1.

### Two defects found while implementing, which this document did not contain

1. **The offline banner added during the PWA hardening work carried the same
   opacity defect UI-4 describes** (`text-muted-foreground/80`). It postdated
   the review, so it could not have been listed. Fixed under the same rule.
2. **The Inbox inferred offline from TanStack Query's `fetchStatus`.** After
   the persisted cache is restored while offline the query settles to `idle`
   rather than `paused`, so the app read as online and fell through to
   "Nothing captured yet" — the exact failure the hardening spec's F2 exists to
   prevent. It is now driven by the browser's connectivity signal. Caught by
   the UI-3 acceptance test.

### Coverage added

Three end-to-end assertions now guard this work: the offline copy reads
"Offline. Saved on this device." with nothing spinning and no retry offered;
the Inbox tab keeps its accessible name while showing the dot; and the capture
flow no longer expects a success toast.

### Still open

The three questions in §9 are unanswered and are yours to decide. My reading of
each is recorded there.

---

## 1. What this is

`docs/spec.md` section 7 set the design direction. The app was then built and
shipped. This document records what a review of the running app found, and
sequences the fixes.

It is not a redesign. The typographic system — Newsreader on the writing
surface against Geist chrome, warm-tinted greys, dark-first — is right and
stays. Four defects in the core capture loop are not, and three of them are
visible on screen rather than theoretical.

### Definition of done

Chris opens the PWA, writes a thought, and saves it. Nothing on screen is
illegible, nothing overlaps, nothing lies about what is happening, and every
piece of text meets WCAG AA. The screen he writes on holds a heading, his
words, and one button.

### The governing principle

**The thought is fleeting. Everything on screen either serves capturing it or
gets deleted.**

`spec.md` says the same thing from the other direction: *"Spend the boldness
[on the capture field] and keep every other screen quiet."* That has been
honoured on the Inbox and lost on Capture, where a word counter, a two-line
toast and a full-viewport focus ring have accumulated around the field. The
edit in P1 is as important as the defect fixes in P0 — it is just less urgent.

### A note on line numbers

Line references below are accurate as of commit `fec83ed` and are there to save
you a search, not to be trusted blindly — `Capture.tsx` in particular is under
active edit. Every ticket also quotes the code or names the symbol it means.
**If a line number and a quoted snippet disagree, the snippet is correct.**

### How to verify

Playwright is already configured against a phone viewport. Every ticket below
carries acceptance criteria written to be checkable that way. Screenshots at
`devices["Pixel 7"]` are the review medium — this app is used one-handed
before it is used at a desk.

---

## 2. Priorities

| | Meaning | Ship when |
|---|---|---|
| **P0** | Defect. Visible on screen, or actively misinforms the user. | Immediately, as one batch |
| **P1** | The minimalism edit. Removing what distracts. | Next |
| **P2** | Feel. The two micro-interactions that are earned, plus the sheet. | After P1 lands and has been used |
| **P3** | Housekeeping and accessibility nits. | Opportunistically, or in one sweep |

P0 is four tickets and is the only section with urgency. Do not start P2 before
P1 — the micro-interactions in P2 replace elements that P1 deletes, and doing
them in the other order means building things twice.

---

## 3. P0 — defects in the core loop

### UI-1 — The confirmation toast renders unstyled and overlaps the heading

**Priority:** P0. Highest. This fires on every single capture.

**Files:** `apps/web/src/components/ui/sonner.tsx`, `apps/web/src/main.tsx`,
`apps/web/package.json`

**Symptom.** Saving a capture shows "Captured / Filing it now." as transparent,
card-less text sitting directly on top of the "Morning" heading. No background,
no border, illegible.

**Root cause.** Two independent faults compounding.

1. `sonner.tsx` sets `--normal-bg: var(--popover)`, `--normal-text:
   var(--popover-foreground)` and `--normal-border: var(--border)`. The theme
   defines `--color-popover`, `--color-popover-foreground` and `--color-border`
   (`styles.css` lines 56, 57, 67). Tailwind v4's `@theme` block emits variables
   *exactly as named* — it does not also emit unprefixed aliases. All three
   resolve to nothing, so sonner falls back to a transparent card.
   `--border-radius: var(--radius)` is the one line that works, because
   `--radius` genuinely is defined.
2. `sonner.tsx` calls `useTheme()` from `next-themes`, but no `ThemeProvider`
   is mounted anywhere in the app. `theme` destructures to its `"system"`
   default, so on a light-mode OS sonner would style itself light inside a dark
   application.

**Fix.** Point at the tokens that exist and stop pretending the app is
themeable. It is dark-only and `index.html` hardcodes `class="dark"`.

```tsx
<Sonner
  theme="dark"
  className="toaster group"
  icons={{ /* unchanged */ }}
  style={
    {
      "--normal-bg": "var(--color-popover)",
      "--normal-text": "var(--color-popover-foreground)",
      "--normal-border": "var(--color-border)",
      "--border-radius": "var(--radius)",
    } as React.CSSProperties
  }
  {...props}
/>
```

Remove the `useTheme` import. `next-themes` then has no remaining consumer —
drop it from `package.json`. Drop `zustand` in the same commit; it has never
been imported. (`spec.md` section 4 names Zustand for local UI state. It has
not been needed. Amend that line rather than keeping an unused dependency.)

**Note for UI-6.** This toast is scheduled for deletion in P1. Fix it anyway —
P1 may slip, and shipping a broken toast in the meantime is not acceptable. The
fix is four lines.

**Acceptance.**
- Capture a thought; the toast renders as a solid card against
  `--color-surface`, with a visible border, not overlapping the heading.
- `grep -r "next-themes\|zustand" apps/` returns nothing.
- `grep -rn "var(--popover)\|var(--border)\b" apps/web/src` returns nothing.

---

### UI-2 — The writing surface wears a hard white ring the entire time you write

**Priority:** P0

**Files:** `apps/web/src/styles.css`

**Symptom.** Focusing the capture field draws a bright, near-white 2px rounded
rectangle around almost the full viewport. Because the field is focused for the
whole time the user is writing, the ring is effectively permanent.

**Root cause.** `styles.css` lines 121–124 set a global
`:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; }`,
and `--color-ring` is mapped to `--color-text` (`#f2f0ee`). Browsers match
`:focus-visible` on text inputs on *every* focus regardless of input modality,
so this is not a keyboard-only style. The `focus-visible:ring-0` already on the
Textarea in `Capture.tsx` line 79 suppresses Tailwind's box-shadow ring only,
not the outline.

**Fix.** Keep the global rule — it is correct, and the comment above it
(*"Visible focus, always. Never remove it for aesthetics"*) is a good
instruction that should stay. Carve out the one element that is its own focus
indicator:

```css
/*
 * ...except the writing surface, where the caret already shows focus and a
 * ring around the page's only content is noise rather than affordance. Every
 * other control — buttons, chips, the sign-in inputs — keeps the outline.
 */
[data-slot="textarea"]:focus-visible {
  outline: none;
}
```

This is scoped to shadcn's `data-slot` rather than a bare `textarea` selector so
it stays tied to the component, and it deliberately does **not** touch `input`
— the sign-in form has two fields and genuinely benefits from a visible focus
indicator when tabbing between them.

**Acceptance.**
- Typing in the capture field shows a caret and no outline.
- Tabbing to the Capture button, the nav buttons, the Inbox filter chips and
  both sign-in inputs still shows the outline.

---

### UI-3 — Offline shows an indefinite "Syncing…" spinner

**Priority:** P0

**Files:** `apps/web/src/lib/outbox.ts`, `apps/web/src/screens/Capture.tsx`,
`apps/web/src/screens/Inbox.tsx`

**Symptom.** With the device offline, capturing a thought shows "Syncing 1…"
with a spinning icon. It stays that way indefinitely. The app never tells the
user it is offline.

**Root cause.** `flush()` returns early on `if (!navigator.onLine) return;`
(`outbox.ts` line 75) without incrementing `attempts`. The pending pill in
`Capture.tsx` branches on `stuck = pending.filter(p => p.attempts > 0).length`,
which therefore stays at `0`, selecting the optimistic spinner branch.

The early return is correct behaviour — there is no point attempting a request
with no network, and inflating `attempts` would burn the retry budget on
something that was never tried. The bug is that the UI has only two states for
three situations.

**Fix.** Introduce offline as a first-class third state.

`spec.md` section 7 says failure states are *"directive, not apologetic."*
Offline is not a failure at all — it is the case the local-first outbox was
built for, and it works. Say so:

| State | Icon | Copy |
|---|---|---|
| Syncing | `RefreshCw`, spinning | `Syncing 1…` |
| **Offline** | `CloudOff`, **static** | `Offline. Saved on this device.` |
| Stuck (`attempts > 0`, online) | `CloudOff` in `--color-danger` | `1 couldn't sync. They're saved here.` + Retry |

Offline takes precedence over syncing when both would apply. The Retry
affordance should not appear while offline — there is nothing to retry against.

Track online state in a small hook rather than reading `navigator.onLine` at
render, so it re-renders on change:

```ts
// apps/web/src/lib/useOnline.ts
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
```

Apply the same three-state treatment to the pending rows in `Inbox.tsx`
(lines 123–139), which have the identical two-state bug.

**Acceptance.**
- Playwright: `context.setOffline(true)`, capture a thought, assert the copy
  reads `Offline. Saved on this device.` and that no element is spinning.
- `context.setOffline(false)` — the pill returns to syncing and then clears as
  the capture lands.
- The existing "stuck" state (online, insert genuinely failing) is unchanged.

---

### UI-4 — Muted text fails WCAG AA across the app

**Priority:** P0

**Files:** `apps/web/src/styles.css`, `apps/web/src/screens/Inbox.tsx`,
`apps/web/src/screens/Capture.tsx`, `apps/web/src/components/CaptureDetail.tsx`

**Symptom.** Timestamps, day headers, entity labels, chip counts and the
capture placeholder are all below the AA threshold against `--color-bg`
(`#0c0b0d`).

| Token | Used for | Ratio | Required | |
|---|---|---|---|---|
| `muted-foreground` | body copy | 6.8:1 | 4.5:1 | pass |
| `muted-foreground/70` | timestamps, day headers, entity labels | **3.8:1** | 4.5:1 | fail |
| `muted-foreground/60` | chip counts | **3.1:1** | 4.5:1 | fail |
| `muted-foreground/40` | capture placeholder (27px, large text) | **2.0:1** | 3.0:1 | fail |

**Root cause.** Applying an opacity modifier to a token that is *already*
muted. `--color-muted` (`#9b96a3`) is correctly pitched at 6.8:1; every `/70`,
`/60` and `/40` on top of it compounds the dimming a second time and lands
below the line. The base token is fine. The pattern applied to it is not.

**Fix.** Add one honest token and stop using opacity for text colour.

```css
/* In @theme, alongside --color-muted. */
--color-muted-dim: #83808a;   /* 5.1:1 on --color-bg. Quieter, still legible. */
```

Replace at these exact sites — all become `text-muted-dim`:

| File | Line | Currently |
|---|---|---|
| `screens/Inbox.tsx` | 157 | `text-muted-foreground/70` (day header) |
| `screens/Inbox.tsx` | 181 | `text-muted-foreground/70` (relative time) |
| `screens/Inbox.tsx` | 270 | `text-muted-foreground/60` (chip count) |
| `components/CaptureDetail.tsx` | 96, 114, 161 | `text-muted-foreground/70` (section headings) |
| `screens/Capture.tsx` | 99 | `placeholder:text-muted-foreground/40` |

Two sites are **excluded** — both are decorative, `aria-hidden`, and carry no
information, so the text contrast rules do not apply:

- `App.tsx` line 41 — the loading pulse dot.
- `Inbox.tsx` line 219 — the empty-state `PenLine` icon, which sits beside its
  own text label.

After this change, no `text-*` class in the app should carry an opacity
modifier. Add that as a review rule.

**Context, for anyone tempted to soften this.** `spec.md` section 7: *"Used in
transit, in cars, on sites, one-handed, often in poor light."* This is the
worst possible reading environment, and the contrast budget should be spent
generously rather than trimmed.

**Acceptance.**
- `grep -rn "text-muted-foreground/" apps/web/src --include=*.tsx` returns
  exactly one line outside `components/ui/`: the decorative empty-state icon at
  `Inbox.tsx` line 219. Every other match is gone.
- Spot-check the four ratios above with any contrast checker; all ≥ 4.5:1
  except the placeholder, which must be ≥ 3.0:1 as large text.

---

## 4. P1 — the minimalism edit

Four deletions and one state change. No new dependencies. This is the section
that gets the app back to the brief.

### UI-5 — Delete the word counter

**Priority:** P1

**File:** `apps/web/src/screens/Capture.tsx` lines 65, 137–141

Remove the `const words = …` calculation and the `{words} words` span inside
the Capture button. Counting the words invites the user to *evaluate* the
thought they have just had, which is precisely the friction the app exists to
remove. The button reads `Capture` and nothing else.

Keep the `saving` state and its `Saving…` label — that is honest feedback about
an operation in progress, not decoration.

**Acceptance.** The button's accessible name is `Capture` (or `Saving…` while a
write is in flight). Note that `e2e/capture.spec.ts` matches on `/^Capture/`
and will continue to pass.

---

### UI-6 — Delete the confirmation toast

**Priority:** P1. Do UI-11 first or in the same change.

**Files:** `apps/web/src/screens/Capture.tsx` line 52, `apps/web/src/App.tsx`
line 76

"Captured / Filing it now." is two lines of copy explaining something the
cleared field has already communicated. Remove the success `toast()` call only:

```ts
toast("Captured", { description: "Filing it now." });   // ← delete this line
```

**Keep the `toast.error("Couldn't save that", …)` call in the same function.**
That one reports a genuine failure the user cannot otherwise see, and it is the
reason the `toast` import and the `<Toaster />` mount in `App.tsx` both stay.

This ticket depends on UI-11 (the departure animation) landing first or
alongside, so that the capture still has a visible acknowledgement. If UI-11 is
not being done in the same sprint, **hold this ticket** — a silent, instant
clear with no other signal is worse than a working toast.

**Acceptance.** Capturing a thought produces no toast, and the departure
animation from UI-11 plays.

---

### UI-7 — The Capture button fills rather than fades

**Priority:** P1

**File:** `apps/web/src/screens/Capture.tsx` line 133

`disabled:opacity-20` leaves a large, dead grey slab at the bottom of an
otherwise empty screen — the single heaviest element on the Capture view when
there is nothing to capture.

Make the empty state an outline button and the active state solid. The button
then *fills* as the first character lands, which reads instantly and rewards
typing, at zero cost in chrome.

Use shadcn's existing variants rather than hand-rolling opacity:

```tsx
<Button
  variant={text.trim() ? "default" : "outline"}
  ...
/>
```

Keep the button in the layout at all times — do not conditionally render it, or
the field height will jump as the user types.

**Acceptance.** Empty: outlined, transparent fill, disabled. One character
typed: solid, enabled. No layout shift between the two.

---

### UI-8 — Collapse the area chips in the detail sheet

**Priority:** P1

**File:** `apps/web/src/components/CaptureDetail.tsx` lines 113–156

Eight always-expanded chips form the visually loudest block in the sheet while
serving its rarest action. Show the current area as a single chip with a quiet
`Change` affordance beside it; reveal the full grid on tap.

Do not change the write behaviour. `corrected_area_id` and `corrected_at`
continue to be written exactly as they are now — `spec.md` is explicit that the
gap between model choice and user choice is the only honest signal about
whether the taxonomy is right, and the existing comment in this file says so
too. This ticket changes how the control is *revealed*, not what it records.

**Acceptance.** Sheet opens showing one chip. Tapping `Change` reveals the
grid. Correcting an area writes the same two columns it does today.

---

### UI-9 — Recompute the greeting and date on resume

**Priority:** P1

**File:** `apps/web/src/screens/Capture.tsx` lines 10–15 (`greeting()`), 69–74
(the `<header>`)

`greeting()` and `new Date()` are evaluated during render. An installed PWA
lives in memory for days, so the header will show "Morning" at 9pm and
yesterday's date after midnight.

Recompute on `visibilitychange`. The greeting is worth keeping — it is the only
warmth on an otherwise deliberately empty screen — but it has to be true.

**Acceptance.** Backgrounding the app across a boundary and returning updates
both the greeting and the date.

---

## 5. P2 — feel

Two micro-interactions and one component swap. These are earned because
everything else is still. **Do not add a third.**

Both animations inherit the existing `prefers-reduced-motion` block in
`styles.css` lines 126–134, which already reduces all transition and animation
durations to `0.01ms`. Verify rather than assume — implement them as CSS
transitions or Web Animations, not as `setTimeout`-driven state, or that block
will not apply.

### UI-10 — Swap the detail Dialog for a Drawer

**Priority:** P2. Largest single improvement to how the app feels.

**File:** `apps/web/src/components/CaptureDetail.tsx`

The detail view is a full-screen `Dialog`, so the only way out is a small × in
the corner. On mobile the expected gesture is swipe-down. shadcn's sanctioned
answer is `Drawer` (vaul):

```sh
cd apps/web && pnpm dlx shadcn@latest add drawer
```

Keep `Dialog` for the `sm:` breakpoint and up, where a centred modal is right
and there is no swipe gesture to honour. shadcn's documented responsive
pattern — `Drawer` below `sm`, `Dialog` above — is the shape to follow.

**Acceptance.** On a phone viewport the sheet can be dismissed by dragging
down. On desktop it remains a centred dialog. Focus trapping and Escape still
work in both.

---

### UI-11 — The thought departs

**Priority:** P2. Blocks UI-6.

**File:** `apps/web/src/screens/Capture.tsx`

On save, the text should visibly leave: translate up roughly 12px and fade to
zero over ~180ms, ease-out, and then the field clears. It answers *"where did
it go?"* physically instead of with a sentence of copy, and it pays off the
`ArrowUp` already sitting in the button.

Constraints:
- The field must accept new input immediately. The animation is decoration over
  an operation that has already completed — never gate `enqueue()` on it.
- Start the animation only once `enqueue()` has resolved. `save()` deliberately
  clears the field *after* the local write is durable, and the comment above it
  explains why: clearing first loses the thought outright if the write rejects.
  Do not reorder that to make the animation start sooner.
- The draft must already be cleared via `clearDraft()` before the animation
  starts, so an eviction mid-animation cannot resurrect a captured thought.

**Acceptance.** Text animates upward and out on save; the field is focused and
writable before the animation finishes. With `prefers-reduced-motion: reduce`,
the text simply disappears.

---

### UI-12 — The Inbox tab acknowledges

**Priority:** P2

**Files:** `apps/web/src/App.tsx`, `apps/web/src/lib/outbox.ts`

A small dot on the Inbox nav icon while anything is in flight, which settles
when the last capture is filed. It teaches the app's model — thoughts land over
*there* — without a word of copy, and it is what makes UI-6's toast deletion
safe.

Drive it from the existing outbox `subscribe()`, plus captures not yet at
`status = 'done'`. The dot is decorative; the nav button's accessible name must
not change, so mark it `aria-hidden` and, if a count is genuinely useful later,
expose it through `aria-label` rather than by rendering a number.

**Acceptance.** Dot appears on capture, clears when the row reaches `done`.
The nav button's accessible name stays `Inbox`.

---

## 6. P3 — housekeeping and accessibility

Small, independent, no ordering between them.

| ID | Item | File |
|---|---|---|
| UI-13 | `theme-color` is `#0B0D10` in both `index.html` and the manifest; the actual background is `#0c0b0d`. Different colours — a visible seam at the status bar in the installed PWA. Set both to `#0c0b0d`. | `index.html` line 11, `public/manifest.webmanifest` |
| UI-14 | Sticky day header sits inside the `px-6` container while rows use `-mx-2 w-[calc(100%+1rem)]`, so rows scroll past it in an 8px sliver each side. Its `bg-background/90` also does not match the body's radial gradient, which is why the band reads as a visible lighter rectangle. Give the header the same negative margin and padding. | `screens/Inbox.tsx` line 157 |
| UI-15 | ~~`role="presentation"` on a div with an `onClick` handler.~~ **Already fixed** after this review, in the commit that replaced the wrapper with a `<label>`. A wrapping label focuses the control natively and is strictly better than the handler it replaced. No work required — listed only so it is not re-reported. | `screens/Capture.tsx` line 80 |
| UI-16 | `DialogContent` has no `DialogDescription`, so Radix logs an accessibility warning on every open. Pass `aria-describedby={undefined}` deliberately, or add a description. | `components/CaptureDetail.tsx` line 65 |
| UI-17 | `<nav>` has no `aria-label`. Add one. | `App.tsx` line 53 |
| UI-18 | Inbox titles `truncate` to a single line. Two lines is kinder for a capture log — `line-clamp-2`, matching the summary below it. | `screens/Inbox.tsx` line 178 |
| UI-19 | `components/ui/card.tsx` and `components/ui/scroll-area.tsx` are not imported anywhere. Delete them, or use them. | `components/ui/` |
| UI-20 | `spec.md` section 4 mandates React Hook Form; it is not installed and `SignIn` is hand-rolled `useState`. The hand-rolled version is correct for two fields. Amend the spec rather than adding the dependency. | `docs/spec.md` |

---

## 7. Out of scope

Deliberately not in this document. Recorded so nobody adds them under cover of
"UI work", and so the reasoning is not relitigated.

- **A light theme.** The app is dark-first by design and `index.html` hardcodes
  `class="dark"`. UI-1 makes this explicit rather than pretending otherwise.
- **A third screen, or a settings screen.**
- **Sign-out, delete and archive.** Real gaps — "Inbox" is a promise of
  triage-to-zero that the UI does not currently keep — but they are product
  decisions, not UI defects. See open questions.
- **Search.** Not until the capture count makes it necessary.
- **Any further animation** beyond UI-11 and UI-12.
- **Replacing the hand-rolled empty states and chips with more shadcn.** They
  are small, correct and idiomatic. Leave them.

`spec.md`'s governing principle applies here too: **features are earned by
observed need, not anticipated need.**

---

## 8. Build order

1. **UI-1, UI-2, UI-3, UI-4.** All of P0, as one batch. Independent of each
   other; parallelise freely. Ship before starting anything below.
2. **UI-13 through UI-20.** All of P3. Mechanical, low-risk, and doing them
   early means they stop appearing in every subsequent diff review.
3. **UI-5, UI-7, UI-8, UI-9.** The P1 edits that carry no dependency.
4. **UI-11, then UI-6.** In that order — the departure animation replaces the
   toast, so the toast is only deleted once its replacement is on screen.
5. **UI-12, UI-10.** The remaining feel work.

P3 is sequenced second, ahead of higher-priority work, on purpose: it is a pile
of one-line changes that will otherwise be re-noticed by every reviewer of
every later change. Clear it while the context is fresh.

Ship each step to a working state before starting the next.

---

## 9. Open questions for Chris

**Implementer's readings, for you to overrule.** None of these were decided
unilaterally; the code sits where the spec left it.

1. *Greeting:* kept and fixed, per the ticket. It is now true rather than
   stale, which was the actual defect. If it should go, deleting it and the
   date is a two-line change.
2. *Sign-out, delete, archive:* still absent. Sign-out is the one I would do
   first regardless of the log-vs-queue answer — a session in a bad state is
   currently unrecoverable without developer tools, and there is now a
   persisted query cache that has to be cleared with it.
3. *Log or queue:* unanswered, and it is the one that should not be guessed.
   Everything shipped works either way; only archive/delete depends on it.

---

1. **Does the greeting stay?** UI-9 keeps and fixes it on the reviewer's
   judgement that it is the only warmth on the Capture screen. A stricter
   reading of the governing principle deletes it and the date both. Your call.
2. **Sign-out, delete, archive.** All three are missing. The review's
   expectation is that delete or archive is the first friction you hit in a
   fortnight of real use, because "Inbox" implies triage-to-zero. Worth
   confirming against how you actually use it rather than deciding now.
3. **Is the Inbox a log or a queue?** UI-8, UI-12 and the archive question all
   resolve differently depending on the answer. If it is a log, the current
   reverse-chronological list is finished. If it is a queue, it needs a way for
   things to leave it, and that is a bigger piece of work than anything in this
   document.
