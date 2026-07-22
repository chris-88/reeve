# Reeve: Architecture Spec — Web Push

Status: **Built and deployed, 22 July 2026.** One acceptance criterion is
outstanding and it is Chris's: WP-F6.3, a notification arriving on a real
iPhone installed to the Home Screen.
Owner: spec-owned. Implementation runs in separate sessions — where this
document is wrong, ambiguous or silent, raise it against the spec rather than
deciding it in the diff.
Extends: `docs/arc-spec-pwa-hardening.md` §4, which defers this
Blocks: `docs/arc-spec-phase-1.md` P1-F6.7 and P1-F10.3
Audience: implementing dev team

Feature IDs are prefixed `WP-`.

---

## 0. Implementation status

| Feature | Status |
|---|---|
| **WP-F1** Keys and configuration | ✅ Done |
| **WP-F2** Subscription storage | ✅ Done — migration `0008_push_subscriptions.sql` |
| **WP-F3** Service worker handlers | ✅ Done |
| **WP-F4** Asking for permission | 🔶 Capability and settings path done. The **inline ask (WP-F4.3) has no home yet** — its moment is a change request being filed, which is P1-F9 |
| **WP-F5** Sending | ✅ Done — Edge Function `send-push` |
| **WP-F6** Verification | 🔶 F6.1 done. **F6.3 outstanding — needs a real iPhone** |

### Verified

- **The keypair is a genuine pair.** WP-F1.1 asks for this before anything is
  configured, and it is not ceremony: a public key from one generation and a
  private key from another have valid shapes individually and fail only when a
  real push is attempted. The private key was imported as a P-256 key, the
  public point derived from it, and the two compared; it then signed and
  verified a probe.
- **The whole send path, against the deployed function.** Two subscriptions
  were stored for the test account with a real ECDH public key and a real auth
  secret, so the payload was genuinely encrypted rather than merely posted.
  One endpoint answering `404` was pruned; one answering `401` kept its row and
  recorded `last_error`; the failure of one did not abort the other. That
  exercises WP-F5.1 through WP-F5.3 and the VAPID signing under them.
- `send-push` refuses everything but the service key — no auth and the
  publishable key both get `401`, a `GET` gets `405`.
- `pnpm build` does not contain the VAPID private key, and `check-bundle.mjs`
  now fails on it by name (WP-F1.2). Verified with a planted value.
- 70 unit tests and 7 end-to-end tests pass.

### Not verified, and why

**A notification has never actually arrived on a device.** Everything up to the
push service accepting the request is exercised above; delivery is not, and
WP-F6.2 is explicit that it must not be simulated — neither Playwright engine
can accept a real push, and a mock would test the mock. WP-F6.3 is the gate:
install to the Home Screen on the iPhone, turn notifications on in Settings,
and send. Until that happens this feature is built, not proven.

### Where this document was silent

- **There was no settings surface to put WP-F4.5 in.** The spec treats "a
  settings row" as the secondary path and reasonably assumes one exists; Reeve
  has three screens and no settings anywhere. A minimal sheet was added behind
  a single icon in the Due header — the screen about being told things, and the
  obvious home for sign-out when hardening F10 lands.
- **WP-F3.3 cannot write the rotated subscription itself.** The worker has no
  Supabase client and no session, and the spec's fallback — "a plain `fetch`
  against the REST endpoint" — cannot satisfy an owner-scoped insert policy
  with the publishable key alone. The worker posts to any open page instead,
  and `syncSubscription()` on next launch is the durable repair. The window in
  which a rotated endpoint is dead is therefore "until the app is next opened",
  which is the same window the outbox already lives with.
- **Migration numbering collided again.** `arc-spec-phase-1.md` names
  `0008_change_requests.sql`; Web Push landed first and took `0008`, so change
  requests become `0009`. Two approved documents cannot both own the next
  integer — the number belongs in `pnpm db:status`, not in a spec.

---

## 1. Why this exists

The hardening spec placed Web Push in its §4 out-of-scope table with a stated
earning condition:

> Phase 1's approval gate needs a delivery channel. "Agents draft, Chris
> approves" is unworkable if approval requires remembering to open the app.

Phase 1 is approved, so that condition is met. Two features are blocked on it
today and a third will be:

| Dependent | Needs |
|---|---|
| `arc-spec-phase-1.md` P1-F6.7 | The daily brief is delivered by push. A brief that requires remembering to open the app will not be read, and the whole value is that it arrives |
| `arc-spec-phase-1.md` P1-F10.3 | Notification when a change request ships. Without it the loop from thought to merged pull request has no closing event |
| `arc-spec-phase-1.md` §8 (Stage 6) | The approval gate. Not approved, but it is the reason this capability is worth building properly rather than minimally |

This is deliberately a separate document rather than a feature inside Phase 1.
It is a cross-cutting capability that two stages depend on; nesting it inside
one of them would make the other depend on a sub-feature of its sibling.

### The one thing that makes this cheap

`apps/web/src/sw.ts` is an owned service worker, not a generated one. The
hardening round chose `injectManifest` over `generateSW` explicitly so that
push, background sync and a share target would be edits rather than a
restructure, and the file says so in a comment. That decision is now being
cashed in — WP-F3 is an addition to an existing file, not a migration.

---

## 2. The constraints that shape this

iOS is the primary target and its rules are stricter than the web platform's.
Every design decision below follows from one of these. None are negotiable.

| Constraint | Consequence |
|---|---|
| iOS 16.4+ only, and **only when installed to the Home Screen** | Push is unavailable in a Safari tab. The permission request must not be shown to a browser-tab user, because it cannot succeed |
| Permission must be requested from a **user gesture** | No asking on load, no asking from a `useEffect`. It must hang off a tap |
| **No silent push.** Every push must display a notification | A push used only to sync data will get the permission revoked by the platform. Do not use push as a data channel |
| A denied permission is **effectively permanent** | The app cannot re-prompt. Asking at the wrong moment burns the only chance there is. WP-F4 exists entirely because of this line |
| Subscriptions expire, and are dropped when the app is uninstalled or its storage cleared | Dead subscriptions accumulate and every send against them fails. WP-F5 is not optional housekeeping |

---

## 3. Features

### WP-F1 — Keys and configuration

**Priority:** P0 · **Blocked on:** Chris providing the keypair

- **WP-F1.1** Generate a VAPID keypair and configure four values, not two:

  | Name | Where | Why |
  |---|---|---|
  | `VITE_VAPID_PUBLIC_KEY` | Browser bundle + CI variable | `pushManager.subscribe` needs it client-side. Public by design |
  | `VAPID_PUBLIC_KEY` | Supabase function secrets | **The sender needs it too.** VAPID signing takes the whole keypair — `setVapidDetails(subject, publicKey, privateKey)` — so the public key must reach the Edge Function as well, under an unprefixed name |
  | `VAPID_PRIVATE_KEY` | Supabase function secrets only | Secret. Never referenced from `apps/web`, and never under a `VITE_` prefix |
  | `VAPID_SUBJECT` | Supabase function secrets | Required by the VAPID spec and enforced by every client library — a `mailto:` or `https:` URL identifying the sender. Omitting it throws at send time, not at deploy time |

  Verify the pair before configuring anything: import the private key as a
  P-256 key, derive the public point, and compare. A public key from one
  generation and a private key from another have valid shapes individually and
  fail only at the moment a real push is attempted.
- **WP-F1.2** Add `VAPID_PRIVATE_KEY` to the `SECRETS` array in
  `scripts/check-bundle.mjs`. A VAPID private key is 32 base64url bytes and has
  no distinctive prefix, so the pattern-matching half of that script cannot
  catch it — the exact-value check is the only defence, and it only works if
  the name is listed.
- **WP-F1.3** Add both variables to `.env.example` with a comment placing them
  on the correct side of the public/secret line, matching how that file already
  documents the others.
- **WP-F1.4** Validate `VITE_VAPID_PUBLIC_KEY` in `apps/web/src/lib/env.ts`
  with the other Zod-checked variables. A missing key must fail at boot, not at
  the moment someone taps "notify me".

### WP-F2 — Subscription storage

**Priority:** P0

```sql
create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  last_error  text
);

create index push_subscriptions_by_user on push_subscriptions (user_id);
```

- **WP-F2.1** Owner-scoped RLS for select, insert and delete, matching the
  existing table policies. Delete is permitted here — unlike captures and
  commitments, a subscription is disposable infrastructure and revoking one
  must actually remove it.
- **WP-F2.2** `endpoint` is unique. Re-subscribing on the same device must
  upsert, not accumulate. One device that reinstalls twice should leave one row.
- **WP-F2.3** A user may hold several subscriptions — phone and desktop are
  separate. Sending means sending to all of them.

### WP-F3 — Service worker handlers

**Priority:** P0 · **Depends on:** WP-F2

Three handlers added to `apps/web/src/sw.ts`.

- **WP-F3.1** `push` — parse the payload, show a notification. If the payload
  is missing or unparseable, still show a generic notification. Showing
  something wrong is recoverable; showing nothing risks the permission.
- **WP-F3.2** `notificationclick` — close the notification, then focus an
  existing window if one is open and navigate it to the target, rather than
  opening a second one. Add `launch_handler: { client_mode: "focus-existing" }`
  to the manifest in `vite.config.ts` to match.
- **WP-F3.3** `pushsubscriptionchange` — re-subscribe and update the stored
  row. The service worker cannot reach the Supabase client, so this posts to
  the page when one is open and falls back to a plain `fetch` against the
  REST endpoint when none is.
- **WP-F3.4** **The payload carries identifiers, not content.** A notification
  body may contain a change request title, which the user wrote themselves. It
  must never contain `raw_text`, a commitment body, or anything the model
  extracted. This is the same discipline as hardening F7.4, and it matters more
  here because a notification renders on a lock screen.

### WP-F4 — Asking for permission

**Priority:** P0 · **Depends on:** WP-F3

A denied permission cannot be re-requested. This feature is small and it is the
one most likely to be got wrong.

- **WP-F4.1** Never request on load, and never from an effect.
- **WP-F4.2** Detect the preconditions before offering: `Notification` and
  `PushManager` exist, and on iOS the app is running standalone
  (`navigator.standalone` or the `display-mode: standalone` media query). Where
  they are not met, show nothing at all — an offer that cannot succeed is worse
  than no offer.
- **WP-F4.3** Ask at the point the value is self-evident, not before. The
  moment is the first time a change request is filed (P1-F9) — "tell me when
  this ships" is a question the user has just earned the context to answer.
  A settings row is the secondary path for anyone who declined the inline ask
  by ignoring it.
- **WP-F4.4** A dismissed offer is not a denial. Do not call
  `requestPermission()` until the user taps the affirmative control, so that
  ignoring the prompt leaves the door open.
- **WP-F4.5** Surface the current state honestly in settings: enabled,
  not yet asked, denied at the browser level, or unsupported on this device.
  "Denied" must explain that it can only be changed in system settings, because
  the app genuinely cannot fix it.

### WP-F5 — Sending

**Priority:** P0 · **Depends on:** WP-F1, WP-F2

- **WP-F5.1** A shared `sendPush(userId, notification)` helper in the Edge
  Function layer, used by every sender. Two call sites building VAPID headers
  two different ways is how one of them quietly stops working.
- **WP-F5.2** Send to every subscription belonging to the user, concurrently,
  and never let one failure abort the others.
- **WP-F5.3** **Handle `404` and `410` by deleting the subscription row.** The
  push service is telling you the endpoint is gone — the user uninstalled, or
  cleared storage. A row left in place fails on every subsequent send forever.
  Any other error code updates `last_error` and leaves the row alone.
- **WP-F5.4** Sending is best-effort and never blocks the work that triggered
  it. A brief that generated but failed to notify is still a brief; the
  notification is not the transaction.
- **WP-F5.5** Push failures are logged, not surfaced. Per P1-F6.8, a failure at
  seven in the morning must not produce a user-facing error.

### WP-F6 — Verification

**Priority:** P1

- **WP-F6.1** Unit-test the payload builder and the `404`/`410` pruning logic.
  Both are pure and both are where the bugs will be.
- **WP-F6.2** **Do not attempt to test delivery in CI.** Neither Playwright
  engine can accept a real push from a real push service, and a mock would
  test the mock. State the gap rather than simulating coverage — the hardening
  spec's handling of the WebKit offline gap is the pattern.
- **WP-F6.3** Manual verification on a real iPhone, installed to the Home
  Screen, is the acceptance gate. Record the result in this document's status
  section the way `arc-spec-pwa-hardening.md` §0 does.

---

## 4. Out of scope

| Deferred | Earned when |
|---|---|
| **Notification actions** (approve/reject from the notification itself) | Stage 6. An action button that performs an outbound write from a lock screen needs the approval ledger behind it, not before it |
| **Badging** (`navigator.setAppBadge`) | You find yourself wanting a count of what is owed on the icon. Cheap to add once subscriptions exist; not worth its own decision now |
| **Background Sync** | Still the hardening spec's §4 entry, unchanged. It shares the service worker but nothing else |
| **Scheduled/local notifications** | Never on iOS — the platform does not offer them to web apps. Any reminder must originate server-side |

---

## 5. Sequencing

```
WP-F1 keys ──► WP-F2 storage ──► WP-F3 handlers ──► WP-F4 permission
                                        └──────────► WP-F5 sending ──► WP-F6
```

WP-F1 is blocked on the keypair. Everything else follows directly and the whole
document is small — this is one body of work, not four.

Build it **before** P1-F6 and P1-F10, which is the only reason it is urgent.
P1-F7 and P1-F8 do not depend on it and can proceed in parallel.

---

## 6. Definition of done

1. A notification arrives on a real iPhone, installed to the Home Screen, from
   a server-side send.
2. Tapping it focuses the existing app rather than opening a second window.
3. No notification payload contains capture text, commitment text, or model
   output. Verified by inspection.
4. Uninstalling the app and sending again prunes the dead subscription rather
   than failing repeatedly.
5. A browser-tab user on iOS is never shown an offer that cannot succeed.
6. `pnpm build` fails if the VAPID private key reaches the bundle.
