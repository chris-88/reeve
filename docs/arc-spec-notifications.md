# Reeve: Notifications that close the loop

Status: **Approved to build, 2026-11-02 (Chris: "move fast and break things").** Spec and build run
back to back; deviations are recorded in §0 by the implementing session.
Owner: spec-owned.
Extends: `arc-spec-web-push.md` (the transport, built and proven on the iPhone 2026-07-31),
`arc-spec-bridge.md` BR-3.4 (a push on every result).
Audience: implementing agent, and Chris.
Feature IDs are prefixed `PN-`.

---

## 0. Implementation status

**Built 2026-11-02 (branch `bridge`, with the bridge; not merged).** Functions deployed to the
self-hosted stack, migration `0018_notifications.sql` applied, service restarted. Web changes
go live when the branch reaches `main`.

| Feature | Status |
|---|---|
| **PN-1** Deep links | ✅ `lib/route.ts`, `App.tsx` hash routing, `NeedsYou` focus, worker `NAVIGATE` message; every sender updated |
| **PN-2** Badge | ✅ `send-push` adds `badge`; worker and app apply it (`lib/badge.ts`) |
| **PN-3** Due reminders | ✅ `notify-due` function, `run_due_reminders()` at 06:30/07:30 UTC acting at Dublin hour 7. Proven by hand: `{"sent":1,"today":1}` for a probe commitment, 20:42:44Z |
| **PN-4** Ask at Go | ✅ `lib/pushAsk.ts`, `PushAsk` in `NeedsYou`; Go copy changed; clipboard gone; "Copy brief" on the card |
| **PN-5** Tags | ✅ `action:<id>` + `renotify`; brief `brief`, due `due`, bridge `bridge` |
| **PN-6** Worker cache routes | ✅ match the origin of `VITE_SUPABASE_URL`; verified in the built `sw.js` |
| **PN-7** Paused / stalled | ✅ pause push tagged and addressed; `report_stuck_actions()` on the five-minute job, `actions.stuck_alerted_at` |

Tests: `tests/route.test.ts`, `tests/push.test.ts` (badge), `tests/due.test.ts` (both 2026 clock
changes), `tests/push-ask.test.ts`, bridge unit and live suites updated for the new payload;
`e2e/notifications.spec.ts` drives the address and stubs the Badging API. The whole unit suite
(158) and the e2e suite (8) pass locally against the stack at `localhost:8001`.

### Deviations from the spec

- **PN-1.4**: the worker no longer calls `client.navigate()` at all for an open page; it posts a
  `NAVIGATE` message and the page sets its own hash. `navigate()` reloaded the app under an open
  outbox. A closed app still gets `openWindow(url)` and reads the hash on boot.
- **PN-1.2**: "expand the card" is implemented as opening the card's sheet (`ActionDetail`),
  which is what expanding means in this app; the row is also scrolled into view.
- **PN-2.2**: the badge has two writers on purpose: the app's live count query (interval plus
  realtime invalidation) and the stream's own visible count, which includes decisions still in
  the outbox. Both converge on the same number.
- **PN-3.2**: the Dublin-hour guard lives in the SQL function (`run_due_reminders(force)`), not in
  the edge function, so `notify-due` stays callable at any hour for a check. Users are selected
  in SQL by "something open and dated no later than the end of today in Dublin".
- **PN-3.1**: the body also carries the overdue count when today is non-zero
  (`<first> and n more · m overdue`).
- **PN-4.1**: the ask is a card at the top of the stream rather than "under" the action, because
  Go removes the action from the stream at once. Snooze is a week in `localStorage`.
- **PN-7.2**: the alert's deep link is `/#/work` (the Work board has no per-card address). Redo
  now re-stamps `dispatched_at` so a second stall is reported again.
- **PN-7.1**: the pause push's tag is `bridge`, shared with the stall alert.
- A side effect of PN-1 worth knowing: a reload keeps the current screen (it is in the hash).
  The offline e2e test assumed a reload returned to Write and was adjusted.
- **Found while testing:** the live `reeve-bridge` service claims any action the test suites
  dispatch, within a second, and runs Claude Code on it. `tests/bridge-live.test.ts` now refuses
  to run while the service is active; stop it before `pnpm test` and start it after.
- Migration numbering: `0018_notifications.sql` (the bridge took 0016 and 0017). The unmerged
  August `capture-images` branch also claims 0016 and must be renumbered when rebased.

## 1. Why now

Push works. One subscription (Chris's iPhone), last used by the bridge at 18:30 today, no error.
`send-push` is sound and three senders use it: the daily brief, the GitHub "shipped" webhook, and
now the bridge. What is missing is everything around the push that makes it useful:

- **A tap goes nowhere useful.** The app has no router; `App.tsx` holds `screen` in state. The
  worker navigates to the payload's `url` (`/due`, `/#/needs-you`) and the app ignores it. With
  the bridge pushing on every result, the tap must land on that result's card.
- **No count anywhere.** iOS 16.4+ supports the Badging API for Home Screen web apps. A minimal UI
  wants a number on the icon more than it wants another screen.
- **Nothing says what is due.** Commitments have `due_at`; the only scheduled push is the 05:10
  UTC brief. Reeve never says "two things are due today".
- **The ask has no home.** WP-F4.3 left the inline permission request for "the moment the value is
  self-evident". That moment is now the first Go: the result arrives by push.
- **Self-hosting broke the worker's cache routes.** `sw.ts` matches `url.hostname.endsWith(".supabase.co")` for areas and captures. The API is `api.chrisquinn.ie/reeve` since today, so offline reads of areas and captures no longer have the service-worker fallback.

## 2. Constraints

- iOS Home Screen web apps render no notification action buttons (treated as fact; if WebKit
  changes this, PN-5 is where buttons would go). Approve and Redo therefore happen in the app,
  one tap away, not on the lock screen.
- Badge counts are allowed before notification permission is granted, and change in the
  foreground or while the worker handles a push.
- A push with no visible notification gets the permission revoked on iOS. Every push shows.
- Notification text stays within WP-F3.4: the action's title (Chris's words) and one line Reeve
  wrote to be read on a lock screen. Never a capture's raw text, never a `private` note's content.

## 3. Features

### PN-1 Deep links
- **PN-1.1** Hash routes the app understands: `#/capture`, `#/needs-you`, `#/needs-you/<actionId>`,
  `#/work`, `#/due`. `App.tsx` derives `screen` from the hash on boot and on `hashchange`, and
  writes the hash when the nav is tapped. No router dependency; thirty lines.
- **PN-1.2** `NeedsYou` accepts a focused action id: scrolls the card into view, expands it, and
  clears the focus once seen. If the action is no longer in Needs you (already approved), show
  the screen with a one-line toast "Already handled".
- **PN-1.3** Every sender uses the new paths: bridge results `/#/needs-you/<id>`, failures the
  same, brief `/#/due`, webhook "shipped" `/#/needs-you`, due reminders `/#/due`.
- **PN-1.4** The worker's `notificationclick` already focuses and navigates; keep it, and make the
  in-app `hashchange` listener do the rest.

**Acceptance.** Tap a bridge result's notification on the iPhone: the app opens on that card.

### PN-2 Badge
- **PN-2.1** The badge is the Needs you count: actions with `status in ('proposed','review')`
  for the user. Set with `navigator.setAppBadge(n)` and `clearAppBadge()` when zero.
- **PN-2.2** The app sets it whenever the Needs you query settles (realtime keeps it live).
- **PN-2.3** `send-push` computes the same count server-side and includes it as `badge` in the
  payload; the worker calls `setAppBadge` in the push handler, so the icon is right before the
  app is opened. One helper, `needsYouCount(db, userId)`, shared by brief, webhook and bridge
  through `send-push` itself: senders do not compute it.
- **PN-2.4** Guard every call with `"setAppBadge" in navigator`.

**Acceptance.** Two results arrive while the app is closed; the icon shows 2; approving one in
the app drops it to 1; the last approval clears it.

### PN-3 Due reminders
- **PN-3.1** New edge function `notify-due` (service key only, like `send-push`): for each user
  with open commitments, count `due_at` in today's Dublin day and overdue (`due_at < start of
  today`, status open). If either is non-zero, push: title `Due today: <n>` (or `Overdue: <m>`
  when today is zero), body = the first due item's text plus `and <n-1> more`, tag `due`, url
  `/#/due`.
- **PN-3.2** Scheduled by pg_cron at 07:30 Europe/Dublin, DST-safe: schedule the job for both
  06:30 and 07:30 UTC and have the function return early unless the Dublin local hour is 7 (the
  same idiom as any DST-correct cron on a UTC database). The vault secret and `net.http_post`
  shape follow `reeve-daily-brief` in the migrations.
- **PN-3.3** No push when nothing is due. Silence is the signal that the day is clear.

**Acceptance.** Seed a commitment due today; run the function; one push with the right count.

### PN-4 The ask at Go
- **PN-4.1** On Go, when `pushSupported()` and `Notification.permission === "default"`: after
  the action moves to Queued, show one inline line under it, "Reeve will tell you when this is
  done. Allow notifications?" with Allow and Not now. Allow calls `enablePush(userId)`. Not now
  sets a local flag so the line appears again only after a week.
- **PN-4.2** When permission is `denied`: no prompt, ever; Settings already explains.
- **PN-4.3** The Go copy changes to match the bridge: the row action reads "Hand to Reeve", the
  queued state reads "Reeve has it", and nothing is copied to the clipboard. The clipboard
  behaviour was the manual handoff the bridge replaced (AQ-4). Keep a long-press or overflow
  "Copy brief" for the day the bridge is down.

**Acceptance.** Fresh install, first Go shows the ask once; Allow results in a push on the next
result.

### PN-5 Tags and replacement
- **PN-5.1** Bridge pushes use `tag: action:<id>` and `renotify: true`, so a Redo's second
  result replaces the first notification instead of stacking.
- **PN-5.2** Brief keeps `tag: brief`; due reminders `tag: due`; "bridge paused" `tag: bridge`.
- **PN-5.3** No `actions` array in the payload (constraint §2).

### PN-6 Worker cache routes follow the configured API
- **PN-6.1** Replace the `.supabase.co` hostname matches in `sw.ts` with a match on the origin
  of `VITE_SUPABASE_URL` (available at build time) and a pathname that *contains*
  `/rest/v1/areas` or `/rest/v1/captures`, so the `/reeve` prefix is tolerated.
- **PN-6.2** The hardening spec's offline e2e tests already cover the behaviour; they must pass
  against the new matcher.

### PN-7 Bridge paused and bridge down
- **PN-7.1** BR-8's "Bridge paused: daily limit" push exists in the worker; give it the tag and
  deep link from PN-5 and PN-1.
- **PN-7.2** If an action has been `dispatched` for more than 30 minutes and the bridge has not
  claimed it (service down), the existing `reeve-stuck-alert` cron job pushes once per action:
  "Reeve hasn't picked this up", url to the card. Extend the job, do not add another.

## 4. Deliberately not in this spec

- Approve and Redo from the notification itself: iOS renders no buttons. The deep link plus a
  one-tap Approve at the top of the card is the whole of it.
- The worker rewriting a rotated subscription on its own (WP-F3.3 fallback): one device, and
  `syncSubscription` runs on every launch.
- Background Sync, quiet hours, per-domain notification preferences. Earn them.
- A notifications screen or history. Needs you is the history.

## 5. Build order

1. PN-6 (ten minutes, and it is a live regression).
2. PN-1 routes and focus, PN-5 tags, senders updated (bridge `push.ts`, brief, webhook).
3. PN-2 badge, app and worker sides, `send-push` gains `badge`.
4. PN-4 ask and Go copy.
5. PN-3 `notify-due` function, cron job, migration.
6. PN-7.

Unit tests for the hash parser, the badge count helper, the due-window maths (Dublin, DST
boundaries 2026-03-29 and 2026-10-25), and the ask's once-a-week flag. e2e: deep link opens the
card; badge call made on Needs you change (mock `setAppBadge`).

## 6. Sources

Verified 2026-11-02 against `main..bridge`: `apps/web/src/sw.ts` (push and notificationclick
handlers, `.supabase.co` matchers), `apps/web/src/App.tsx` (`screen` state, no router),
`apps/web/src/lib/push.ts` (`pushState`, `enablePush`, `syncSubscription`),
`apps/web/src/components/Settings.tsx` (the only `enablePush` caller),
`supabase/functions/brief/index.ts` `notify()` (`url: "/due"`, `tag: "brief"`),
`supabase/functions/send-push/index.ts` (`{ user_id, notification }`, service key only),
`apps/bridge/src/push.ts`; live `push_subscriptions` (one iPhone row, `last_used_at` 18:30
today, no error), `cron.job` (daily-brief 05:10 UTC, file-sweep, reap, stuck-alert, sweep),
`commitments` columns (`due_at`, `status`, `text`). WebKit: Home Screen web apps gained Web Push
and the Badging API in iOS 16.4; permission requests need a user gesture.
