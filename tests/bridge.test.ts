import { describe, expect, it } from "vitest";
import { commitmentFingerprint as sharedFingerprint } from "../packages/shared/src/index.ts";
import { AREA_CONTEXTS, contextFor, expandHome } from "../apps/bridge/src/areas.ts";
import { commitmentFingerprint } from "../apps/bridge/src/db.ts";
import {
  buildPrompt,
  describeDecomposition,
  parseDecomposeResult,
  parseTaskResult,
  type PromptAction,
} from "../apps/bridge/src/prompt.ts";
import { rateLimited } from "../apps/bridge/src/ratelimit.ts";
import { RESULT_MAX_CHARS } from "../apps/bridge/src/config.ts";

/** The pure half of the bridge (docs/arc-spec-bridge.md). The live half is bridge-live.test.ts. */

const action = (over: Partial<PromptAction> = {}): PromptAction => ({
  title: "Ring the foreman about the pour",
  brief: "# Ring the foreman\n\n## What Chris said\nring him Thursday",
  kind: "task",
  area_id: "home",
  result: null,
  feedback: null,
  ...over,
});

describe("BR-2 area routing", () => {
  const DOMAINS = ["family", "kids", "home", "health", "money", "admin", "boi", "baz", "homeown", "phibsboro", "reeve", "ideas"];

  it("has a context for every vault domain plus unsorted", () => {
    for (const d of [...DOMAINS, "unsorted"]) expect(AREA_CONTEXTS[d], d).toBeDefined();
  });

  it("falls back to unsorted for an unknown or missing area", () => {
    expect(contextFor(null)).toBe(AREA_CONTEXTS.unsorted);
    expect(contextFor("contracting")).toBe(AREA_CONTEXTS.unsorted);
  });

  it("lets only the six life domains read private notes", () => {
    const privateOk = Object.entries(AREA_CONTEXTS).filter(([, c]) => c.privateOk).map(([id]) => id).sort();
    expect(privateOk).toEqual(["admin", "family", "health", "home", "kids", "money"]);
  });

  it("keeps boi vault-only (the BOI boundary)", () => {
    expect(contextFor("boi")).toMatchObject({ cwd: "~/vault", addDirs: [], privateOk: false });
    expect(contextFor("boi").note).toMatch(/BOI boundary/);
  });

  it("expands ~ for the process and leaves absolute paths alone", () => {
    expect(expandHome("~/vault", "/home/chris")).toBe("/home/chris/vault");
    expect(expandHome("/tmp/x", "/home/chris")).toBe("/tmp/x");
  });
});

describe("BR-3.1 prompt", () => {
  it("carries the brief, the three rules, the area context and the output contract", () => {
    const p = buildPrompt({ action: action(), context: contextFor("home"), rawText: "", commitments: [] });
    expect(p).toContain("ring him Thursday");
    expect(p).toContain("You draft.");
    expect(p).toContain("~/vault/atlas/home.md");
    expect(p).toContain("may be read for this area");
    expect(p).toContain("What I did:");
    expect(p).not.toContain("second pass");
  });

  it("assembles a brief from the capture when the action has none", () => {
    const p = buildPrompt({ action: action({ brief: null }), context: contextFor("home"), rawText: "bins out tuesday", commitments: [] });
    expect(p).toContain("## What Chris said\nbins out tuesday");
  });

  it("tells a work-domain run that private notes are off-limits", () => {
    const p = buildPrompt({ action: action({ area_id: "homeown" }), context: contextFor("homeown"), rawText: "", commitments: [] });
    expect(p).toContain("off-limits for this area");
    expect(p).toContain("~/code/homeown-mvp");
  });

  it("BR-5.2: a redo carries the previous result and Chris's note", () => {
    const p = buildPrompt({
      action: action({ result: "What I did: drafted a reply", feedback: "too long, and wrong name" }),
      context: contextFor("home"),
      rawText: "",
      commitments: [],
    });
    expect(p).toContain("second pass");
    expect(p).toContain("Previous attempt:\nWhat I did: drafted a reply");
    expect(p).toContain("Chris said:\ntoo long, and wrong name");
  });

  it("BR-6.3: a decompose asks for JSON and lists existing commitments", () => {
    const p = buildPrompt({
      action: action({ kind: "decompose", brief: null }),
      context: contextFor("unsorted"),
      rawText: "a long dump",
      commitments: [{ text: "Put the bins out", due_text: "Tuesday" }],
    });
    expect(p).toContain("```json");
    expect(p).toContain("- Put the bins out (Tuesday)");
    expect(p).not.toContain("What I did:");
  });
});

describe("BR-3.3 result parsing", () => {
  it("trims and keeps a result within the limit", () => {
    expect(parseTaskResult("  What I did: x\nWhere: nothing written\nFor you: approve  \n")).toBe(
      "What I did: x\nWhere: nothing written\nFor you: approve",
    );
  });

  it("returns null for an empty result so the caller treats it as a failure", () => {
    expect(parseTaskResult("   \n")).toBeNull();
  });

  it("clips an overlong result with a marker", () => {
    const r = parseTaskResult("x".repeat(RESULT_MAX_CHARS * 2))!;
    expect(r.length).toBeLessThan(RESULT_MAX_CHARS + 80);
    expect(r).toMatch(/\[clipped/);
  });
});

describe("BR-6.3 decompose parsing", () => {
  const good = {
    summary: "Three things from the school run.",
    actions: [
      { title: "Book the dentist", brief: "Ring the practice; mornings suit." },
      { title: "Reply to the coach", brief: "Say yes to Saturday." },
    ],
    commitments: [{ text: "Pay the creche invoice", due_text: "Friday", due_at: "2026-11-06" }],
    notes: ["+/fleeting/reeve/2026-11-02-school-run.md"],
  };

  it("reads the last json fence", () => {
    const out = `Some preamble\n\`\`\`json\n{"summary":"old"}\n\`\`\`\nthen\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\``;
    const r = parseDecomposeResult(out);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.actions).toHaveLength(2);
  });

  it("accepts a bare JSON object", () => {
    expect(parseDecomposeResult(JSON.stringify(good)).ok).toBe(true);
  });

  it("rejects prose, and a bad date, with a reason", () => {
    expect(parseDecomposeResult("I broke it down into three things.")).toEqual({ ok: false, error: expect.stringMatching(/not a JSON object/) });
    const bad = { ...good, commitments: [{ text: "x", due_at: "Friday" }] };
    expect(parseDecomposeResult(JSON.stringify(bad)).ok).toBe(false);
  });

  it("describes what was created in the three-line shape", () => {
    const text = describeDecomposition(good);
    expect(text).toMatch(/^What I did: /);
    expect(text).toContain("- Book the dentist");
    expect(text).toContain("Where: +/fleeting/reeve/2026-11-02-school-run.md");
    expect(text).toMatch(/For you: /);
  });
});

describe("commitment identity", () => {
  it("matches the shared fingerprint triage uses, so a decompose cannot duplicate a commitment", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(await commitmentFingerprint(id, "Ring the  foreman. ")).toBe(await sharedFingerprint(id, "ring the foreman"));
  });
});

describe("BR-8 rate limit", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("allows under both limits", () => {
    expect(rateLimited([ago(10), ago(200)], now, { perHour: 6, perDay: 30 })).toEqual({ limited: false });
  });

  it("pauses at the hourly limit, counting only the last hour", () => {
    const r = rateLimited([ago(5), ago(15), ago(25), ago(35), ago(45), ago(55), ago(120)], now, { perHour: 6, perDay: 30 });
    expect(r).toMatchObject({ limited: true, reason: expect.stringMatching(/hourly/) });
    expect(rateLimited([ago(5), ago(15), ago(25), ago(35), ago(45), ago(65)], now, { perHour: 6, perDay: 30 })).toEqual({ limited: false });
  });

  it("pauses at the daily limit even when the last hour is quiet", () => {
    const runs = Array.from({ length: 30 }, (_, i) => ago(90 + i * 30));
    expect(rateLimited(runs, now, { perHour: 6, perDay: 30 })).toMatchObject({ limited: true, reason: expect.stringMatching(/daily/) });
  });
});
