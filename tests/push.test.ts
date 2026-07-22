import { describe, expect, it } from "vitest";
import { buildPushPayload, isSubscriptionGone } from "../packages/shared/src/push.ts";

describe("buildPushPayload", () => {
  it("carries only the fields the worker reads", () => {
    // WP-F3.4. The payload renders on a lock screen, so a field added upstream
    // and forgotten here must not reach the wire. Copying field by field is
    // what makes that true; this is the test that keeps it true.
    const payload = JSON.parse(
      buildPushPayload({
        title: "A change shipped",
        body: "3 commitments due",
        url: "/due",
        tag: "shipped",
        // @ts-expect-error — exactly the mistake this guards against
        raw_text: "ring the foreman about the pour",
      }),
    );
    expect(Object.keys(payload).sort()).toEqual(["body", "tag", "title", "url"]);
    expect(JSON.stringify(payload)).not.toContain("foreman");
  });

  it("refuses a url that is not a same-origin path", () => {
    // notificationclick navigates to this. A payload is attacker-controlled
    // the moment anything upstream of it is.
    for (const url of ["https://evil.example/x", "//evil.example/x", "javascript:alert(1)"]) {
      expect(JSON.parse(buildPushPayload({ title: "t", url }))).not.toHaveProperty("url");
    }
    expect(JSON.parse(buildPushPayload({ title: "t", url: "/due" })).url).toBe("/due");
  });

  it("always produces a title", () => {
    // A push that displays nothing costs the permission, permanently.
    expect(JSON.parse(buildPushPayload({ title: "   " })).title).toBe("Reeve");
  });

  it("flattens and clips long text", () => {
    const payload = JSON.parse(
      buildPushPayload({ title: "a".repeat(200), body: `line\n\nline  ${"b".repeat(400)}` }),
    );
    expect(payload.title.length).toBeLessThanOrEqual(120);
    expect(payload.body.length).toBeLessThanOrEqual(300);
    expect(payload.body).not.toContain("\n");
  });

  it("omits an absent body rather than sending an empty one", () => {
    expect(JSON.parse(buildPushPayload({ title: "t" }))).not.toHaveProperty("body");
    expect(JSON.parse(buildPushPayload({ title: "t", body: "  " }))).not.toHaveProperty("body");
  });
});

describe("isSubscriptionGone", () => {
  it("prunes on 404 and 410", () => {
    // The push service saying the endpoint no longer exists. Kept, it fails on
    // every send from now on and the failure rate stops meaning anything.
    expect(isSubscriptionGone(404)).toBe(true);
    expect(isSubscriptionGone(410)).toBe(true);
  });

  it("keeps the row for anything else", () => {
    // 401/403 mean the VAPID configuration is wrong. Deleting a user's
    // subscriptions because the sender is misconfigured would be a rout.
    for (const status of [0, 400, 401, 403, 429, 500, 502, 503]) {
      expect(isSubscriptionGone(status), `status ${status}`).toBe(false);
    }
  });
});
