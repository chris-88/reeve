import { CAPTURE_IMAGE_BUCKET, checkCaptureImage } from "@reeve/shared";
import type { CaptureImage } from "./outbox";
import { supabase } from "./supabase";

/**
 * Reading a screenshot in, and reading one back out.
 *
 * The rules themselves are in `@reeve/shared` — the bucket enforces the same
 * ones, and the Edge Functions will need them if the deferred vision path is
 * ever earned. What is here is only the browser half.
 */

/** What the composer holds while a screenshot is attached but not yet saved. */
export type Attachment = CaptureImage & { name: string };

export type AttachmentResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; message: string };

/**
 * Validate a chosen file and turn it into something the outbox can carry.
 *
 * The same path serves the picker, a paste and a drop: all three hand over a
 * `File`, and none of them is more trustworthy than the others.
 */
export function attachmentFrom(file: File): AttachmentResult {
  const check = checkCaptureImage({ type: file.type, size: file.size });
  if (!check.ok) return { ok: false, message: check.message };
  return {
    ok: true,
    attachment: {
      // The File itself is a Blob, and structured-clones into IndexedDB as one.
      blob: file,
      mime: check.mime,
      bytes: file.size,
      // Pasted screenshots arrive as "image.png" or with no name at all; the
      // preview needs something to say either way.
      name: file.name || "Screenshot",
    },
  };
}

/** The first image on a clipboard or a drop, if there is one. */
export function imageFromTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    // Anything file-shaped is offered up rather than filtered on type here, so
    // that an unsupported drop gets the rejection message instead of silence.
    if (file) return file;
  }
  return null;
}

/**
 * One hour. Long enough that a sheet left open does not go blank mid-read,
 * short enough that a URL copied out of the DOM is not a durable leak.
 */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** A time-limited URL for a private object. Throws, so a query can retry it. */
export async function signedCaptureImageUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CAPTURE_IMAGE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}
