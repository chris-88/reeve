import { describe, expect, it } from "vitest";
import { shouldOffer, snooze, SNOOZE_KEY, SNOOZE_MS } from "../apps/web/src/lib/pushAsk.ts";

/** PN-4: the once-a-week offer. */
function store(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("shouldOffer", () => {
  const t0 = Date.UTC(2026, 10, 2, 20, 0, 0);

  it("offers only while the permission has never been asked", () => {
    expect(shouldOffer("default", store(), t0)).toBe(true);
    expect(shouldOffer("granted", store(), t0)).toBe(false);
    // A denial cannot be undone by the app; never offer into it.
    expect(shouldOffer("denied", store(), t0)).toBe(false);
    expect(shouldOffer("unsupported", store(), t0)).toBe(false);
  });

  it("rests for a week after Not now, then offers again", () => {
    const s = store();
    snooze(s, t0);
    expect(shouldOffer("default", s, t0)).toBe(false);
    expect(shouldOffer("default", s, t0 + SNOOZE_MS - 1)).toBe(false);
    expect(shouldOffer("default", s, t0 + SNOOZE_MS)).toBe(true);
  });

  it("treats a corrupt snooze value as no snooze", () => {
    expect(shouldOffer("default", store({ [SNOOZE_KEY]: "soon" }), t0)).toBe(true);
  });
});
