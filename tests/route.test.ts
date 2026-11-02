import { describe, expect, it } from "vitest";
import { actionPath, DUE_PATH, NEEDS_YOU_PATH, WORK_PATH } from "../packages/shared/src/push.ts";
import { hashFor, parseHash } from "../apps/web/src/lib/route.ts";

/** PN-1.1: the hash parser the app and the push senders agree on. */
describe("parseHash", () => {
  const id = "0064009a-caee-4271-a891-949040b8ad8f";

  it("reads the four screens", () => {
    expect(parseHash("#/capture")).toEqual({ screen: "capture" });
    expect(parseHash("#/needs-you")).toEqual({ screen: "needs-you" });
    expect(parseHash("#/work")).toEqual({ screen: "work" });
    expect(parseHash("#/due")).toEqual({ screen: "due" });
  });

  it("reads a focused action under needs-you, and only there", () => {
    expect(parseHash(`#/needs-you/${id}`)).toEqual({ screen: "needs-you", actionId: id });
    expect(parseHash(`#/needs-you/${id.toUpperCase()}`)).toEqual({ screen: "needs-you", actionId: id });
    // A junk id is not an address: the screen opens, nothing is focused.
    expect(parseHash("#/needs-you/not-an-id")).toEqual({ screen: "needs-you" });
    expect(parseHash("#/needs-you/../x")).toEqual({ screen: "needs-you" });
    expect(parseHash(`#/due/${id}`)).toEqual({ screen: "due" });
  });

  it("falls back to Capture for anything it does not know", () => {
    for (const h of ["", "#", "#/", "#/inbox", "#needs-you"]) {
      expect(parseHash(h), h).toEqual({ screen: "capture" });
    }
  });

  it("round-trips through hashFor", () => {
    for (const r of [{ screen: "work" as const }, { screen: "needs-you" as const, actionId: id }]) {
      expect(parseHash(hashFor(r))).toEqual(r);
    }
    expect(hashFor({ screen: "capture" })).toBe("");
  });

  it("reads the addresses the push senders write (PN-1.3)", () => {
    // A payload url is "/#/…"; the page receives it as a hash. The two modules
    // never import each other, so this is what keeps them in step.
    const hashOf = (path: string) => new URL(path, "https://app.example").hash;
    expect(parseHash(hashOf(actionPath(id)))).toEqual({ screen: "needs-you", actionId: id });
    expect(parseHash(hashOf(NEEDS_YOU_PATH))).toEqual({ screen: "needs-you" });
    expect(parseHash(hashOf(WORK_PATH))).toEqual({ screen: "work" });
    expect(parseHash(hashOf(DUE_PATH))).toEqual({ screen: "due" });
  });
});
