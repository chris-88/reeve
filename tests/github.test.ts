import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { referencedIssues, verifyGithubSignature } from "../packages/shared/src/github.ts";

/** The header GitHub would send for a given body and secret. */
function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("referencedIssues", () => {
  it("reads GitHub's closing keywords", () => {
    // The link between a merged PR and the change request it closes.
    expect(referencedIssues("Closes #12")).toEqual([12]);
    expect(referencedIssues("this fixes #3 and resolves #4").sort()).toEqual([3, 4]);
    expect(referencedIssues("Fixed #7\nsome detail")).toEqual([7]);
  });

  it("falls back to a bare reference", () => {
    expect(referencedIssues("see #99 for context")).toEqual([99]);
  });

  it("deduplicates", () => {
    expect(referencedIssues("Closes #5. Also see #5.")).toEqual([5]);
  });

  it("finds nothing when there is no reference", () => {
    // A PR that links its issue only through GitHub's UI. The honest limit.
    expect(referencedIssues("A pull request with no issue reference")).toEqual([]);
  });
});

describe("verifyGithubSignature", () => {
  const SECRET = "whsec-test-000";
  const BODY = JSON.stringify({ action: "closed", pull_request: { number: 1, merged: true } });

  it("accepts a correctly signed body", async () => {
    expect(await verifyGithubSignature(SECRET, BODY, sign(SECRET, BODY))).toBe(true);
  });

  it("rejects a body signed with a different secret", async () => {
    // The acceptance criterion: an unsigned webhook request is rejected. This
    // is the whole defence of the one public endpoint the project exposes.
    expect(await verifyGithubSignature(SECRET, BODY, sign("wrong-secret", BODY))).toBe(false);
  });

  it("rejects a tampered body", async () => {
    const header = sign(SECRET, BODY);
    const tampered = BODY.replace('"merged":true', '"merged":false');
    expect(await verifyGithubSignature(SECRET, tampered, header)).toBe(false);
  });

  it("rejects a missing or malformed header", async () => {
    expect(await verifyGithubSignature(SECRET, BODY, null)).toBe(false);
    expect(await verifyGithubSignature(SECRET, BODY, undefined)).toBe(false);
    expect(await verifyGithubSignature(SECRET, BODY, "")).toBe(false);
    expect(await verifyGithubSignature(SECRET, BODY, "sha1=abc")).toBe(false);
    expect(await verifyGithubSignature(SECRET, BODY, "deadbeef")).toBe(false);
  });
});
