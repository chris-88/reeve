import { z } from "zod";
import type { AreaContext } from "./areas.ts";
import { RESULT_MAX_CHARS } from "./config.ts";

/** The slice of an action the prompt needs. Kept narrow so tests can build one. */
export type PromptAction = {
  title: string;
  brief: string | null;
  kind: "task" | "decompose";
  area_id: string | null;
  result: string | null;
  feedback: string | null;
};

export type PromptInput = {
  action: PromptAction;
  context: AreaContext;
  /** The capture's own words; the brief for a decompose, the fallback for a task with none. */
  rawText: string;
  /** Open commitments already extracted from the capture, so decompose does not duplicate them. */
  commitments: { text: string; due_text: string | null }[];
};

/** §2 of the spec, as the run reads it. */
const RULES = `Three rules you must not break:
1. You draft. Your output is text and local files. Do not send an email or message, make a payment, change DNS, push to a remote, open a pull request, or call anything that changes the world outside this machine. Approve means "this draft is right", not "send it".
2. You work inside the lines. Your permission allowlist applies unchanged; this is a headless run, so anything outside it is denied rather than asked about. Do not try to work around a denial.
3. You are one assistant, visible as one. Do not spawn parallel work. Finish, then answer.`;

function contextSection(c: AreaContext): string {
  const lines = [
    "Context for this area:",
    "- Read ~/vault/CLAUDE.md first; its folder, front-matter and linking rules apply to anything you file.",
    ...c.maps.map((m) => `- The map for this work is ~/vault/atlas/${m}.md. Start there; everything relevant is within two hops.`),
    `- You are working in ${c.cwd}.` +
      (c.addDirs.length ? ` You may also read and write under ${c.addDirs.join(", ")}.` : "") +
      " Nothing outside those directories may be written.",
    c.privateOk
      ? "- Notes with `sensitivity: private` may be read for this area."
      : "- Notes with `sensitivity: private` are off-limits for this area: if a file's front matter says private, close it and do not use it.",
  ];
  if (c.note) lines.push(`- ${c.note}`);
  return lines.join("\n");
}

function previousAttempt(a: PromptAction): string {
  if (!a.result && !a.feedback) return "";
  const parts = ["This is a second pass. Chris sent the previous attempt back."];
  if (a.result) parts.push(`Previous attempt:\n${a.result.trim()}`);
  if (a.feedback) parts.push(`Chris said:\n${a.feedback.trim()}`);
  parts.push("Address what Chris said; do not repeat what was already right.");
  return parts.join("\n\n");
}

const TASK_CONTRACT = `When you are finished, your final message is the result Chris reads on his phone. Plain text, no Markdown headings or tables, under ${RESULT_MAX_CHARS} characters, in exactly this shape:

What I did: <two or three sentences>
Where: <paths of files written or changed, one per line, or "nothing written">
For you: <what Approve means here, and anything that needs a decision>`;

const DECOMPOSE_CONTRACT = `This capture is a mind dump with several distinct intents. Your job is to break it down, not to do any of it.

For each distinct thing to be done, write a short imperative title and a two-to-four-sentence brief an assistant could act on without the capture. For each dated promise that is not already in the list of existing commitments, give the text, the date phrase as Chris said it, and the resolved date as YYYY-MM-DD (null when it cannot be resolved). Anything that is a note rather than a task, file as a fleeting note under ~/vault/+/fleeting/reeve/ following the vault's CLAUDE.md, and list its path.

Your final message must be a single JSON object in a \`\`\`json fence, nothing before or after it, in this shape:

{
  "summary": "one or two plain sentences on what the dump contained",
  "actions": [{ "title": "Ring the foreman about the pour", "brief": "..." }],
  "commitments": [{ "text": "Put the bins out", "due_text": "Tuesday", "due_at": "2026-11-04" }],
  "notes": ["+/fleeting/reeve/2026-11-02-something.md"]
}

Every action you list becomes a proposed action Chris must still say Go on. Do not dispatch, send, or start anything.`;

/** BR-3.1 / BR-6.3: the whole prompt a run receives. Pure; unit-tested. */
export function buildPrompt(input: PromptInput): string {
  const { action, context } = input;
  const brief = action.brief?.trim() || `# ${action.title}\n\n## What Chris said\n${input.rawText.trim()}`;
  const sections = [
    "You are Reeve, Chris Quinn's assistant, running headlessly on his machine. Chris said Go on the action below in his Reeve app; the result you return lands in his \"Needs you\" stream for Approve or Redo.",
    RULES,
    contextSection(context),
    `The action: ${action.title}`,
    `The brief:\n\n${brief}`,
  ];
  if (action.kind === "decompose" && input.commitments.length) {
    sections.push(
      "Existing commitments from this capture (do not list these again):\n" +
        input.commitments.map((c) => `- ${c.text}${c.due_text ? ` (${c.due_text})` : ""}`).join("\n"),
    );
  }
  const prev = previousAttempt(action);
  if (prev) sections.push(prev);
  sections.push(action.kind === "decompose" ? DECOMPOSE_CONTRACT : TASK_CONTRACT);
  return sections.join("\n\n---\n\n");
}

/** BR-3.3: the text that becomes `actions.result`. Trimmed, clipped, never empty. */
export function parseTaskResult(output: string): string | null {
  const text = output.replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  if (text.length <= RESULT_MAX_CHARS) return text;
  return `${text.slice(0, RESULT_MAX_CHARS - 1).trimEnd()}…\n\n[clipped; the full text is in the bridge log]`;
}

export const DecomposeResult = z.object({
  summary: z.string().min(1),
  actions: z.array(z.object({ title: z.string().min(1).max(200), brief: z.string().min(1) })).max(20),
  commitments: z
    .array(
      z.object({
        text: z.string().min(1),
        due_text: z.string().nullable().optional(),
        due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      }),
    )
    .max(20),
  notes: z.array(z.string()).max(20),
});
export type DecomposeResult = z.infer<typeof DecomposeResult>;

/**
 * BR-6.3: the structured output of a decompose run. The last ```json fence
 * wins; a bare JSON object is accepted too. Returns the zod error message on
 * failure so the action can surface it as a decision rather than vanish.
 */
export function parseDecomposeResult(
  output: string,
): { ok: true; value: DecomposeResult } | { ok: false; error: string } {
  const fences = [...output.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  const candidate = (fences.at(-1) ?? output).trim();
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    return { ok: false, error: "the final message was not a JSON object" };
  }
  const parsed = DecomposeResult.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
}

/** The review text for a decompose action: what was created, for Approve. */
export function describeDecomposition(d: DecomposeResult): string {
  const lines = [`What I did: ${d.summary.trim()} Broke it into ${d.actions.length} proposed action(s), ${d.commitments.length} commitment(s), ${d.notes.length} note(s).`];
  if (d.actions.length) lines.push("Proposed:", ...d.actions.map((a) => `- ${a.title}`));
  if (d.commitments.length) lines.push("Commitments:", ...d.commitments.map((c) => `- ${c.text}${c.due_text ? ` (${c.due_text})` : ""}`));
  lines.push(`Where: ${d.notes.length ? d.notes.join("\n") : "nothing written"}`);
  lines.push("For you: each proposed action is in Needs you waiting for Go. Approve here just files this breakdown.");
  return parseTaskResult(lines.join("\n")) ?? "Decomposed.";
}
