import { describe, expect, it } from "vitest";
import { actionPath, messagePath, noticePath, THREAD_PATH } from "../packages/shared/src/push.ts";
import { hashFor, parseHash } from "../apps/web/src/lib/route.ts";

/** E-3c: the hash parser the app and the push senders agree on. */
describe("parseHash", () => {
  const id = "0064009a-caee-4271-a891-949040b8ad8f";

  it("reads a message address", () => {
    expect(parseHash(`#/m/action:${id}`)).toEqual({ messageId: `action:${id}` });
    expect(parseHash(`#/m/notice:${id}`)).toEqual({ messageId: `notice:${id}` });
    expect(parseHash(`#/m/ACTION:${id.toUpperCase()}`)).toEqual({ messageId: `action:${id}` });
  });

  it("treats anything that is not a message id as the thread", () => {
    for (const h of ["", "#", "#/", "#/needs-you", `#/needs-you/${id}`, "#/m/not-an-id", "#/m/../x", "#/m/action:xyz"]) {
      expect(parseHash(h), h).toEqual({});
    }
  });

  it("round-trips through hashFor", () => {
    const r = { messageId: `action:${id}` };
    expect(parseHash(hashFor(r))).toEqual(r);
    expect(hashFor({})).toBe("");
  });

  it("reads the addresses the push senders write", () => {
    // A payload url is "/#/…"; the page receives it as a hash. The two modules
    // never import each other, so this is what keeps them in step.
    const hashOf = (path: string) => new URL(path, "https://app.example").hash;
    expect(parseHash(hashOf(actionPath(id)))).toEqual({ messageId: `action:${id}` });
    expect(parseHash(hashOf(noticePath(id)))).toEqual({ messageId: `notice:${id}` });
    expect(parseHash(hashOf(messagePath(`capture:${id}`)))).toEqual({ messageId: `capture:${id}` });
    expect(parseHash(hashOf(THREAD_PATH))).toEqual({});
  });
});
