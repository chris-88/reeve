import { describe, expect, it } from "vitest";
import {
  CAPTURE_IMAGE_ACCEPT,
  CAPTURE_IMAGE_MIME_TYPES,
  MAX_CAPTURE_IMAGE_BYTES,
  captureImagePath,
  checkCaptureImage,
} from "../packages/shared/src/capture-images.ts";

/**
 * The attachment rules. Pure, and enforced in three places that must agree:
 * the composer, the bucket (0016), and the object name the outbox uploads to.
 */

const USER = "11111111-1111-1111-1111-111111111111";
const CAPTURE = "22222222-2222-2222-2222-222222222222";

describe("checkCaptureImage", () => {
  it("accepts every type the bucket allows", () => {
    for (const type of CAPTURE_IMAGE_MIME_TYPES) {
      expect(checkCaptureImage({ type, size: 1024 })).toEqual({ ok: true, mime: type });
    }
  });

  it("rejects a type the browser cannot be relied on to render", () => {
    const result = checkCaptureImage({ type: "image/heic", size: 1024 });
    expect(result.ok).toBe(false);
    // The message is shown verbatim, so it has to name the way out.
    if (!result.ok) expect(result.message).toMatch(/PNG, JPEG, WebP or GIF/);
  });

  it("rejects a file that is not an image at all", () => {
    expect(checkCaptureImage({ type: "application/pdf", size: 1024 }).ok).toBe(false);
    expect(checkCaptureImage({ type: "", size: 1024 }).ok).toBe(false);
  });

  it("rejects an oversized image and says what the limit is", () => {
    const result = checkCaptureImage({ type: "image/png", size: 12 * 1024 * 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Both numbers, so the message says how far over it is rather than only
      // that it was refused.
      expect(result.message).toMatch(/12 MB/);
      expect(result.message).toMatch(/limit is 8 MB/);
    }
  });

  it("accepts one exactly at the limit", () => {
    expect(checkCaptureImage({ type: "image/png", size: MAX_CAPTURE_IMAGE_BYTES }).ok).toBe(true);
  });

  it("rejects an empty file", () => {
    // Zero bytes uploads cleanly and comes back as a broken image, which reads
    // as data loss rather than as a bad file.
    expect(checkCaptureImage({ type: "image/png", size: 0 }).ok).toBe(false);
  });
});

describe("captureImagePath", () => {
  it("puts the object in the owner's folder", () => {
    // The storage policy in 0016 checks exactly this segment.
    expect(captureImagePath(USER, CAPTURE, "image/png").split("/")[0]).toBe(USER);
  });

  it("is a pure function of the capture, so a retry overwrites rather than orphans", () => {
    expect(captureImagePath(USER, CAPTURE, "image/jpeg")).toBe(
      captureImagePath(USER, CAPTURE, "image/jpeg"),
    );
    expect(captureImagePath(USER, CAPTURE, "image/jpeg")).toBe(`${USER}/${CAPTURE}.jpg`);
  });

  it("gives every allowed type an extension", () => {
    for (const mime of CAPTURE_IMAGE_MIME_TYPES) {
      expect(captureImagePath(USER, CAPTURE, mime)).toMatch(/\.[a-z]+$/);
    }
  });
});

describe("the accept attribute", () => {
  it("offers the picker exactly what the checker allows", () => {
    expect(CAPTURE_IMAGE_ACCEPT.split(",")).toEqual([...CAPTURE_IMAGE_MIME_TYPES]);
  });
});
