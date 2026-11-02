import { describe, expect, it } from "vitest";
import { dueReminder, dueWindow } from "../packages/shared/src/due.ts";

/** PN-3: due-day maths in Europe/Dublin, across both 2026 clock changes. */
const item = (text: string, due_at: string) => ({ text, due_at });

describe("dueWindow", () => {
  it("splits overdue, today and later by the Dublin calendar day", () => {
    const now = new Date("2026-11-02T07:30:00Z"); // GMT: 07:30 Dublin
    const w = dueWindow(
      [
        item("later", "2026-11-03T00:30:00Z"),
        item("tonight", "2026-11-02T23:59:00Z"),
        item("yesterday", "2026-11-01T23:59:00Z"),
        item("this morning", "2026-11-02T00:00:00Z"),
      ],
      now,
    );
    expect(w.overdue.map((i) => i.text)).toEqual(["yesterday"]);
    expect(w.today.map((i) => i.text)).toEqual(["this morning", "tonight"]);
  });

  it("spring forward, 2026-03-29: 23:30 local the night before is still yesterday", () => {
    // Clocks go forward at 01:00 UTC on 29 March; from then Dublin is UTC+1.
    const now = new Date("2026-03-29T06:30:00Z"); // 07:30 IST
    const w = dueWindow(
      [
        item("late on the 28th", "2026-03-28T23:30:00Z"), // 23:30 GMT, 28 March
        item("late on the 29th", "2026-03-29T22:30:00Z"), // 23:30 IST, 29 March
        item("just into the 30th", "2026-03-29T23:30:00Z"), // 00:30 IST, 30 March
      ],
      now,
    );
    expect(w.overdue.map((i) => i.text)).toEqual(["late on the 28th"]);
    expect(w.today.map((i) => i.text)).toEqual(["late on the 29th"]);
  });

  it("fall back, 2026-10-25: the extra hour does not move a deadline a day", () => {
    // Clocks go back at 01:00 UTC on 25 October; from then Dublin is UTC+0.
    const now = new Date("2026-10-25T07:30:00Z"); // 07:30 GMT
    const w = dueWindow(
      [
        item("late on the 24th", "2026-10-24T22:30:00Z"), // 23:30 IST, 24 October
        item("late on the 25th", "2026-10-25T23:30:00Z"), // 23:30 GMT, 25 October
        item("first thing on the 26th", "2026-10-26T00:10:00Z"),
      ],
      now,
    );
    expect(w.overdue.map((i) => i.text)).toEqual(["late on the 24th"]);
    expect(w.today.map((i) => i.text)).toEqual(["late on the 25th"]);
  });
});

describe("dueReminder", () => {
  const w = (today: string[], overdue: string[]) => ({
    today: today.map((t, i) => item(t, `2026-11-02T0${i}:00:00Z`)),
    overdue: overdue.map((t, i) => item(t, `2026-11-01T0${i}:00:00Z`)),
  });

  it("is silent when nothing is due", () => {
    expect(dueReminder(w([], []))).toBeNull();
  });

  it("leads with today, names the first item, counts the rest and the overdue", () => {
    expect(dueReminder(w(["Ring the foreman", "Pay the ESB"], ["Tax return"]))).toEqual({
      title: "Due today: 2",
      body: "Ring the foreman and 1 more · 1 overdue",
    });
    expect(dueReminder(w(["Ring the foreman"], []))).toEqual({ title: "Due today: 1", body: "Ring the foreman" });
  });

  it("falls back to the overdue when today is clear", () => {
    expect(dueReminder(w([], ["Tax return", "Renew NCT"]))).toEqual({
      title: "Overdue: 2",
      body: "Tax return and 1 more",
    });
  });
});
