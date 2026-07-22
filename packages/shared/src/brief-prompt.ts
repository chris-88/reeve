import { z } from "zod";
import { TIMEZONE } from "./triage-prompt.ts";

/**
 * The daily brief's system prompt and output contract.
 *
 * Its own file, mirroring `triage-prompt.ts`, because the prompt is the
 * feature here — the code around it is thirty lines of plumbing.
 */

/**
 * P1-F6.5: structured output, closed and fully required, the same discipline
 * as `TriageResult`. Structured outputs rejects an object without `required`
 * on every property and `additionalProperties: false`.
 */
export const BriefResult = z.object({
  body: z
    .string()
    .describe(
      "The brief itself, in markdown. At most four short paragraphs or a short list.",
    ),
  headline: z
    .string()
    .describe(
      "At most 10 words, for a notification. No trailing punctuation. Names a count or the single most pressing thing.",
    ),
});
export type BriefResult = z.infer<typeof BriefResult>;

const { $schema: _dropped, ...briefSchema } = z.toJSONSchema(BriefResult, {
  io: "output",
}) as Record<string, unknown>;

export const BRIEF_JSON_SCHEMA = briefSchema;

export type BriefContext = {
  /** Local date the brief is for, e.g. "Wednesday 22 July 2026". */
  today: string;
  overdue: { text: string; due: string | null; area: string | null }[];
  dueToday: { text: string; due: string | null; area: string | null }[];
  dueThisWeek: { text: string; due: string | null; area: string | null }[];
  /** Titles only — a brief is a prompt to look, not a replacement for looking. */
  captured: { title: string; area: string | null }[];
  unsortedCount: number;
};

function list(items: { text: string; due: string | null; area: string | null }[]): string {
  if (items.length === 0) return "  (none)";
  return items
    .map((c) => `  - ${c.text}${c.due ? ` — due ${c.due}` : ""}${c.area ? ` [${c.area}]` : ""}`)
    .join("\n");
}

export function buildBriefSystemPrompt(): string {
  return `You are writing Chris's morning brief. He runs several parallel areas of life — contracting, a software product, a football club, a charity, a day job and family admin — and captures thoughts by dictating them on the move. Overnight, the system has filed them and extracted what he said he would do.

You are writing the first thing he reads today. He is likely to read it on a phone, standing up, before doing anything about it.

Rules:

- Lead with what is overdue. If nothing is overdue, lead with what is due today. If neither, say so plainly and briefly — a quiet morning is good news and should read as good news, not as an apology for having nothing to report.
- Be specific. Name the actual commitments; do not summarise them into "several tasks". He needs to recognise them, and a commitment he cannot recognise is one he cannot act on.
- Group by what he would do next, not by area. Two things that need the same phone call belong together.
- Do not invent anything. Everything you mention must appear in the context below. If the context is thin, the brief is short. Padding a brief is how it stops being read.
- Do not moralise, do not motivate, and do not open with a greeting or the date — he knows what day it is. No "Good morning", no "Here's your brief", no closing encouragement.
- Mention the unsorted pile only if it has grown past a handful, and then in one clause.
- headline: at most 10 words, for a phone notification. Name a count or the single most pressing thing. "3 overdue, foreman still not rung" beats "Your daily brief".

Write in Irish/British English. Times and dates are ${TIMEZONE}.`;
}

export function buildBriefUserPrompt(context: BriefContext): string {
  return `Today is ${context.today}.

Overdue:
${list(context.overdue)}

Due today:
${list(context.dueToday)}

Due later this week:
${list(context.dueThisWeek)}

Captured in the last day:
${
  context.captured.length === 0
    ? "  (none)"
    : context.captured.map((c) => `  - ${c.title}${c.area ? ` [${c.area}]` : ""}`).join("\n")
}

Unsorted captures waiting: ${context.unsortedCount}`;
}
