-- A screenshot attached to a capture.
--
-- Captures have been text since 0001, and text is the right default: a thought
-- dictated in a car has no picture. But some thoughts are *about* something on
-- a screen, and the screen is the context — retyping it loses the very thing
-- being reacted to. This adds one image to a capture.
--
-- The bytes live in Supabase Storage, not in the row. A base64 column would
-- put multi-megabyte payloads into every `select *` the app already makes,
-- including the ones the offline cache persists to the device.

-- ---------------------------------------------------------------------------
-- The pointer on the row.
--
-- `image_mime` is kept rather than inferred from the extension because the
-- deferred vision path (see the spec's §4) needs the exact media type, and
-- reconstructing it from a filename is the kind of guess that is wrong once.
-- ---------------------------------------------------------------------------
alter table captures add column image_path  text;
alter table captures add column image_mime  text;
alter table captures add column image_bytes int;

-- All three together or none. Reading code then only has one question to ask —
-- "is image_path null?" — instead of three that can disagree.
alter table captures add constraint captures_image_complete check (
  (image_path is null and image_mime is null and image_bytes is null)
  or (image_path is not null and image_mime is not null and image_bytes > 0)
);

-- ---------------------------------------------------------------------------
-- The bucket.
--
-- Private. A public bucket serves any object to anyone who can guess its name,
-- and these names are derived from two uuids the owner's own device knows —
-- guessable is not the risk, but "shareable by accident" is, and a screenshot
-- of a bank statement is exactly the content this app attracts.
--
-- The size and type limits repeat what packages/shared/src/capture-images.ts
-- enforces in the composer. Deliberately: the client check is for the message
-- it can give the user, and this one is the check that actually holds.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'capture-images',
  'capture-images',
  false,
  8388608,  -- 8 MB, = MAX_CAPTURE_IMAGE_BYTES
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Owner-only, enforced by the first path segment.
--
-- An object is named <user_id>/<capture_id>.<ext>, so `(foldername(name))[1]`
-- is the owner's id. This is the same shape as the captures policies in 0001:
-- single-user system today, written properly now.
--
-- There is no delete policy, matching captures — an attachment is part of the
-- record, and the record is archived rather than destroyed.
-- ---------------------------------------------------------------------------
drop policy if exists capture_images_select on storage.objects;
create policy capture_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'capture-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists capture_images_insert on storage.objects;
create policy capture_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'capture-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- Update, not for editing an attachment — there is no such affordance — but
-- because the outbox re-uploads to the same key when a response is lost. That
-- retry is an upsert, and an upsert onto an existing object is an update.
drop policy if exists capture_images_update on storage.objects;
create policy capture_images_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'capture-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'capture-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
