/**
 * The rules for the image attached to a capture.
 *
 * They live here rather than in the composer because they are enforced in
 * three places and must not drift: the composer rejects a file before anything
 * is queued, the bucket rejects it again at the edge (a client is not a
 * gatekeeper), and the outbox derives the object's name from them.
 *
 * One image per capture, and only at capture time. Both are the smallest thing
 * that answers the need — see `docs/arc-spec-capture-images.md` for the
 * observation that would earn each of the deferred halves.
 */

/** Private bucket. Reads go through a signed URL; nothing here is public. */
export const CAPTURE_IMAGE_BUCKET = "capture-images";

/**
 * 8 MB. An iPhone screenshot is 1–3 MB and a Retina desktop grab is under 5,
 * so this clears the actual use with room to spare while still refusing the
 * 40 MB photo that would be someone attaching the wrong thing.
 */
export const MAX_CAPTURE_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * What a browser can be relied on to render. HEIC is absent deliberately: only
 * Safari decodes it, so accepting one would store an attachment that the same
 * capture cannot display on a laptop. iOS transcodes to JPEG when a photo is
 * picked through a file input, so this is rarely the path a screenshot takes.
 */
export const CAPTURE_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type CaptureImageMime = (typeof CAPTURE_IMAGE_MIME_TYPES)[number];

/** The `accept` attribute for a file input, kept in step with the list above. */
export const CAPTURE_IMAGE_ACCEPT = CAPTURE_IMAGE_MIME_TYPES.join(",");

const EXTENSIONS: Record<CaptureImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isCaptureImageMime(mime: string): mime is CaptureImageMime {
  return (CAPTURE_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

export type CaptureImageCheck =
  | { ok: true; mime: CaptureImageMime }
  /** Written to be shown to the user verbatim — say what was wrong and what to do. */
  | { ok: false; message: string };

/** "8", not "8.0" — the limit is a round number and should read like one. */
const megabytes = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
};

/**
 * Whether a chosen file can be attached.
 *
 * Takes the two fields a `File` and a clipboard item both carry, so the same
 * function covers the picker, a paste and a drop.
 */
export function checkCaptureImage(file: { type: string; size: number }): CaptureImageCheck {
  const mime = file.type;
  if (!isCaptureImageMime(mime)) {
    return {
      ok: false,
      message: mime
        ? `${mime} isn't supported. Attach a PNG, JPEG, WebP or GIF.`
        : "That doesn't look like an image. Attach a PNG, JPEG, WebP or GIF.",
    };
  }
  // Zero bytes reaches the bucket as a valid upload and comes back as a broken
  // image, which reads as data loss rather than as a bad file.
  if (file.size <= 0) {
    return { ok: false, message: "That image is empty." };
  }
  if (file.size > MAX_CAPTURE_IMAGE_BYTES) {
    return {
      ok: false,
      message: `That image is ${megabytes(file.size)} MB. The limit is ${megabytes(
        MAX_CAPTURE_IMAGE_BYTES,
      )} MB.`,
    };
  }
  return { ok: true, mime };
}

/**
 * Where a capture's image lives.
 *
 * Derived from the ids rather than random, for two reasons. The first segment
 * is the owner's id, which is what the storage policy checks — an object
 * cannot be written outside its owner's folder. And because the name is a pure
 * function of the capture, an upload retried after a lost response overwrites
 * the same object instead of orphaning a second copy.
 */
export function captureImagePath(
  userId: string,
  captureId: string,
  mime: CaptureImageMime,
): string {
  return `${userId}/${captureId}.${EXTENSIONS[mime]}`;
}
