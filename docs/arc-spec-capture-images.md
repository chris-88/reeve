# Architecture spec — a screenshot attached to a capture

Issue #12, filed by Reeve from change request `09a2550e-7cda-4ce1-bbb0-6895a6e1c325`.

> I wanna be able to upload screenshots to provide context in the app

---

## 0. Implementation status

**Built. Not yet applied to the shared database, and not yet deployed.**

| Item | State |
|---|---|
| `0016_capture_images.sql` — columns, bucket, storage RLS | Written. **Pending — must be applied with `pnpm db:migrate` before an attachment can be saved** |
| `packages/shared/src/capture-images.ts` — the rules | Done |
| Outbox carries the blob; uploads, then inserts | Done |
| Composer: picker, paste, drop, preview, rejection | Done |
| `CaptureDetail` renders it behind a signed URL | Done |
| Library list shows an attachment indicator | Done |
| Unit tests — the rules, and the outbox's image path | Done |

**The one thing a later session must know.** The insert names the three image
columns *only when there is an image*, so a text capture's write is
byte-for-byte the one that shipped before this. That is deliberate: it means
this branch can merge and deploy ahead of the migration without stranding
ordinary captures. Attaching is the only thing that fails until `0016` is
applied, and it fails loudly (the capture stays queued and retries), not
silently.

The migration could not be applied from the session that wrote it — it ran on a
GitHub Actions runner, which has no `.env.local` and therefore no
`DATABASE_URL`. `pnpm db:status` first: migration numbers in a spec are the ones
that were free when it was written.

**Not verified by anything automated:** the storage policies. `create policy …
on storage.objects` is run as `postgres`, which is the documented Supabase path,
but it is a different table owner from the rest of the schema. Apply the
migration and then *actually attach a screenshot*, from a signed-in browser —
a policy that is subtly wrong shows up as a 403 on upload, and there is no test
in CI that would catch it, because CI has no bucket.

---

## 1. Why this is earned

The governing principle is that features are earned by observed need. This one
was observed: a capture was written asking for it. The need behind the sentence
is narrower than "image support" — it is *context*. A thought about something on
a screen loses its subject when the screen is not kept, and retyping the screen
into the capture is precisely the friction the app exists to remove.

So: one image, attached to the thought, shown when the thought is opened. Not a
gallery, not an image pipeline.

---

## 2. Decisions

The issue asked seven open questions. Each is answered here, and each answer
that closes a door records what would reopen it in §4.

**Attached when the capture is written, not afterwards.** That is the moment the
screenshot exists — it is on the clipboard, or it has just been taken. The
Library is deliberately a reading room with no decide-or-act control (AQ-8), so
retrofitting an attachment would mean inventing an edit affordance there, which
is a bigger change to the shape of the app than the need justifies.

**One image.** A capture is one thought.

**Every route the device offers.** The file picker (on iOS that is the camera
roll or the camera), a paste into the writing field, and a drop anywhere on the
screen. Paste is the one that matters most on a laptop: the desktop gesture for
"here is what I mean" is a region grab followed by Cmd+V, and sending that
through a file dialog would make the feature slower than not having it.

**Supabase Storage, private, owner-scoped by path.** The bytes are not in the
row: a base64 column would put multi-megabyte payloads into every `select *` the
app already makes, including the ones the offline cache writes to the device.
The bucket is private and read through a signed URL — this app attracts
screenshots of bank statements and messages, and a public bucket serves any
object to anyone holding its name.

**Inline in the capture detail, thumbnail in the composer, indicator in the
list.** The sheet is narrow, so the image is also a link: tapping opens it full
size in a tab. Without the indicator in the Library, an attachment is invisible
until the capture is opened, which makes it unfindable rather than merely
unseen.

**PNG, JPEG, WebP, GIF; 8 MB.** An iPhone screenshot is 1–3 MB and a Retina
desktop grab is under 5, so the ceiling clears the real use with room and still
refuses the 40 MB video-frame export that is someone attaching the wrong thing.
HEIC is excluded on purpose: only Safari decodes it, so accepting one would
store an attachment that the same capture cannot display on a laptop. iOS
transcodes to JPEG when a photo is chosen through a file input, so this is
rarely the path a screenshot takes.

The limits are enforced twice — in the composer, which is where the message to
the user comes from, and on the bucket, which is the check that actually holds.
`packages/shared/src/capture-images.ts` is the single definition both read, and
the migration repeats the numbers with a comment saying so.

**No OCR, no vision.** See §4.

---

## 3. How it works

**Durability first.** The invariant in `CLAUDE.md` — the field clears only after
the write is durable — has to hold with an image attached, so the blob goes into
the outbox with the text. IndexedDB structured-clones a `Blob`, so the picture
is exactly as durable as the words: a capture written in a lift keeps both.
Uploading at save time instead would put the network on the path between the tap
and the field clearing, which is the one thing that queue exists to prevent.

**Upload, then insert.** During a flush, a capture with an image uploads to the
bucket first and only then inserts the row. The other order produces a row whose
`image_path` points at bytes that are not there, and a broken image is
indistinguishable, to the person looking at it, from a lost one. If the upload
fails the whole item stays queued — text included — and retries.

**Replay is safe.** The object key is `<user_id>/<capture_id>.<ext>`, a pure
function of the capture, uploaded with `upsert: true`. A retry after a lost
response overwrites the same object rather than orphaning a second copy, which
is the storage-side counterpart of the `23505`-is-success rule the insert has
always had. The first path segment is also what the storage policy checks, so an
object cannot be written outside its owner's folder.

**An unsaved attachment survives eviction.** The draft text is in
`localStorage`; the draft image is in IndexedDB beside it, because localStorage
holds strings and base64ing a multi-megabyte image into a 5 MB store would fail
on exactly the screenshots worth keeping.

**Signed URLs are never persisted.** `["capture-image", …]` is absent from
`shouldPersistQuery` on purpose: a URL written to disk today and restored
tomorrow is a guaranteed broken image, which reads as a lost attachment. The
in-memory cache expires at half the URL's hour so a long-open session cannot
reach for one that has already gone stale.

**Text is still required.** `raw_text` is `not null` with a non-empty check
(0001), and triage reads words. An image with no text is refused by the Capture
button, and — because a disabled button beside a ready-looking screenshot is
otherwise unexplained — a line appears saying why.

---

## 4. Deferred

Each row names the observation that would earn it. Nothing here is scheduled.

| Deferred | What would earn it |
|---|---|
| More than one image per capture | A capture where the second screenshot was the point, and the workaround was two captures about one thought |
| Attaching to a capture that already exists | Opening a capture and wanting to add the screenshot that was taken after it. Needs an edit affordance the Library does not have — decide what the Library becomes first |
| Removing an attachment | Any wrong attachment saved in earnest. Deliberately absent: captures are archived, not deleted, and an attachment is part of the record |
| Sending the image to triage (vision) | Filing that is visibly wrong *because* the model could not see the picture. This is the expensive one — it changes the per-capture cost model and the ceilings in P1-F5 |
| OCR / text extraction | A search for words that were only ever in a screenshot, that found nothing |
| Client-side downscaling before upload | Uploads that are slow enough to notice on a phone, or a month where storage is the line item that grows |
| HEIC | An iOS path that hands over a real HEIC rather than transcoding — likely a share sheet or a drop, not the picker |
| A thumbnail rather than the full image in the list | The Library becoming slow, or costly, once there are enough attachments to matter |

---

## 5. What was not proven

- **The storage policies.** No test in CI touches a bucket. Attach a screenshot
  by hand after applying the migration, then open the capture on a second
  device.
- **The real-device path.** iOS Safari's picker, and whether a screenshot pasted
  from the iOS clipboard arrives as a `File` on the paste event. The desktop
  paste path is the one that was reasoned about; the phone's was not, and iOS
  clipboard behaviour is the sort of thing this project has been surprised by
  before.
- **Offline with an attachment.** The blob is in the same queue as the text and
  the same tests cover the queue, but the two offline end-to-end tests are
  text-only and both skip on WebKit anyway.
