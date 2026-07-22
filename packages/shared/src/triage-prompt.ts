import type { Area } from "./schemas.ts";
import { UNSORTED_AREA_ID } from "./schemas.ts";

/** Everything Chris's life runs on. Dates resolve against this, not UTC. */
export const TIMEZONE = "Europe/Dublin";

/**
 * The capture's own date, written out for the model.
 *
 * The weekday is spelled out because most of what needs resolving is relative
 * to it — "Thursday" means the coming Thursday, and the model cannot work that
 * out from a bare date without first deriving the day of the week itself.
 */
function referenceDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-IE", {
    timeZone: TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(d);
  return `${parts} (${ymd})`;
}

/**
 * The triage system prompt.
 *
 * Areas are injected from the database, so adding a life area is a row rather
 * than a code change. `classifier_hint` does most of the work here — if triage
 * quality is poor, edit the hints before touching this prompt.
 *
 * `capturedAt` is the capture's own `created_at`, not now. A capture swept off
 * the queue three days late must still resolve "Thursday" against the Thursday
 * Chris meant when he said it.
 */
export function buildTriageSystemPrompt(
  areas: readonly Area[],
  opts: { capturedAt: string },
): string {
  const active = areas
    .filter((a) => a.active)
    .sort((a, b) => a.sort_order - b.sort_order);

  const list = active
    .map((a) => `- ${a.id} (${a.label}): ${a.classifier_hint}`)
    .join("\n");

  return `You are triaging a captured thought for Chris, who runs several parallel areas of life and dictates or types notes to himself on the move. Captures are often fragmentary, unpunctuated, or garbled by dictation. Read past that to the intent.

This capture was written on ${referenceDate(opts.capturedAt)}. Chris is in ${TIMEZONE}. Resolve every relative date against that day.

Assign the capture to exactly one area:

${list}

Rules:

- Pick the area the capture is *about*, not one it merely mentions. A note naming someone from one area, while describing work that belongs to another, goes to the area the work belongs to.
- If the capture spans two areas, choose the one where the next action would happen.
- If you cannot place it confidently, use "${UNSORTED_AREA_ID}". This is not a failure state — a misfiled thought is recoverable and a forced guess trains a bad taxonomy. Prefer "${UNSORTED_AREA_ID}" over a coin-flip.
- title: at most 8 words, no trailing full stop. Write what it is, not "Note about...".
- summary: at most two sentences. If the capture is already one short sentence, restate it plainly rather than padding it.
- entities: extract only what is actually present. Empty arrays are correct and expected; do not invent plausible values.
  - people: names of individuals.
  - dates: any date or time reference, verbatim as written ("next Tuesday", "end of the month").
  - amounts: sums of money or quantities, with their units.
  - orgs: named companies, clubs, bodies or institutions.
- commitments: things Chris has said he will do. One entry each, phrased as the action he takes.
  - text: the action, in plain words. "Ring the foreman about the pour", not "Chris will ring the foreman".
  - due_text: the date phrase exactly as it appears in the capture. Null when he named no date. Do not paraphrase it and do not invent one.
  - due_at: due_text resolved to a calendar date as YYYY-MM-DD. A bare weekday means the next one on or after the capture's date. Null when the phrase is genuinely open-ended ("at some point", "when I get a chance") — a wrong date is worse than no date, because a wrong one is acted on.
  - An empty array is correct and common. A capture that records something rather than promising something has no commitments.

Write in Irish/British English.`;
}
