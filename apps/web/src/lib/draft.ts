/**
 * The in-progress capture, persisted across app eviction.
 *
 * Every access is guarded. `localStorage` throws on quota exhaustion and in
 * some privacy modes, and these calls sit in a render effect and a save
 * handler — an unguarded throw there takes down the screen the user is
 * currently typing into, which is a worse outcome than losing the draft.
 */

import { del, get, set } from "idb-keyval";

const DRAFT_KEY = "reeve.draft.v1";

/**
 * The attached-but-unsaved screenshot.
 *
 * IndexedDB rather than localStorage, because localStorage holds strings and
 * base64ing a multi-megabyte image into a 5 MB store would fail on exactly the
 * screenshots worth keeping. A Blob structured-clones, so this is the same
 * mechanism the outbox uses for the same reason.
 */
const DRAFT_IMAGE_KEY = "reeve.draft-image.v1";

export function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(text: string): void {
  try {
    localStorage.setItem(DRAFT_KEY, text);
  } catch (err) {
    // Non-fatal: the capture itself is durable in IndexedDB once saved. Only
    // the not-yet-saved text is at risk, and there is nothing better to do.
    console.warn("[reeve] could not persist draft", err);
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * The draft's screenshot, if there is one.
 *
 * Guarded like the text above and for the same reason: a rejected IndexedDB
 * read on mount must not take down the screen someone is about to type into.
 * A miss returns null, which reads as "no attachment" — the safe direction,
 * since the text is stored separately and is not at risk either way.
 */
export async function readDraftImage<T>(): Promise<T | null> {
  try {
    return (await get<T>(DRAFT_IMAGE_KEY)) ?? null;
  } catch (err) {
    console.warn("[reeve] could not read the draft image", err);
    return null;
  }
}

export async function writeDraftImage<T>(value: T): Promise<void> {
  try {
    await set(DRAFT_IMAGE_KEY, value);
  } catch (err) {
    console.warn("[reeve] could not persist the draft image", err);
  }
}

export async function clearDraftImage(): Promise<void> {
  try {
    await del(DRAFT_IMAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Ask the browser to exempt our storage from eviction.
 *
 * Safari clears IndexedDB and localStorage after roughly seven days of non-use,
 * and sooner under storage pressure. Both the outbox and the draft live there,
 * so without this the durability guarantee is weaker than advertised.
 *
 * Returns whether the request was granted, so the UI can be honest about it.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    const granted = await navigator.storage.persist();
    console.info("[reeve] persistent storage:", granted ? "granted" : "denied");
    return granted;
  } catch {
    return false;
  }
}
