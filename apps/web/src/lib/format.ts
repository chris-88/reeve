/** Times and days as the thread shows them. Dublin is the device's zone. */

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function midnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Yesterday", "Mon 3 Nov", "3 Nov 2025". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((midnight(now) - midnight(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-IE", { weekday: "long" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export function sameDay(a: string, b: string): boolean {
  return midnight(new Date(a)) === midnight(new Date(b));
}

/** "Friday", "tomorrow", "today", "3 Nov" for a due date. */
export function dueLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((midnight(d) - midnight(now)) / 86_400_000);
  if (days < 0) return days === -1 ? "yesterday" : `${-days} days ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return d.toLocaleDateString("en-IE", { weekday: "long" });
  return d.toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

export function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
