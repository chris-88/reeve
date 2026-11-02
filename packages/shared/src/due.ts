import { TIMEZONE } from "./triage-prompt.ts";

/**
 * PN-3: what is due, by the calendar day in Chris's timezone.
 *
 * Day boundaries come from Intl, not from midnight arithmetic on timestamps: a
 * commitment due at 23:30 Dublin time the night the clocks change must still
 * count as *that* day, and a UTC database cannot tell on its own. Pure, and
 * tested across both 2026 clock changes.
 */
export type DueItem = { text: string; due_at: string };

export type DueWindow = { overdue: DueItem[]; today: DueItem[] };

const dayOf = (() => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (d: Date) => fmt.format(d); // "YYYY-MM-DD", which sorts as a string
})();

export function dueWindow(items: readonly DueItem[], now: Date = new Date()): DueWindow {
  const today = dayOf(now);
  const overdue: DueItem[] = [];
  const due: DueItem[] = [];
  for (const item of [...items].sort((a, b) => a.due_at.localeCompare(b.due_at))) {
    const day = dayOf(new Date(item.due_at));
    if (day < today) overdue.push(item);
    else if (day === today) due.push(item);
  }
  return { overdue, today: due };
}

/**
 * PN-3.1: the morning line, or nothing. Names the first due item (WP-F3.4 as
 * amended: one commitment's own text may appear on the lock screen) and counts
 * the rest. Silence when the day is clear is the point.
 */
export function dueReminder(window: DueWindow): { title: string; body: string } | null {
  const n = window.today.length;
  const m = window.overdue.length;
  if (n === 0 && m === 0) return null;
  const title = n > 0 ? `Due today: ${n}` : `Overdue: ${m}`;
  const lead = (n > 0 ? window.today : window.overdue)[0]!;
  const rest = n > 0 ? n - 1 : m - 1;
  const parts = [lead.text.trim()];
  if (rest > 0) parts.push(`and ${rest} more`);
  if (n > 0 && m > 0) parts.push(`· ${m} overdue`);
  return { title, body: parts.join(" ") };
}
