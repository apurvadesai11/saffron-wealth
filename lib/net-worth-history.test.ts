import { describe, it, expect } from "vitest";
import { computeNetWorthSeries } from "./net-worth-history";
import type { AccountType } from "./types";

// Minimal event fixture — computeNetWorthSeries only reads these four fields.
function ev(
  accountId: string,
  asOf: string,
  balance: number,
  recordedAt: string = `${asOf}T00:00:00.000Z`,
) {
  return { accountId, asOf, balance, recordedAt };
}

function acct(id: string, type: AccountType) {
  return { id, type };
}

describe("computeNetWorthSeries", () => {
  it("returns [] for an empty event list", () => {
    expect(computeNetWorthSeries([], [])).toEqual([]);
    // Even with accounts on the roster but no history at all.
    expect(computeNetWorthSeries([], [acct("a", "cash")])).toEqual([]);
  });

  it("returns one point for a single event", () => {
    const points = computeNetWorthSeries(
      [ev("a", "2026-01-01", 1000)],
      [acct("a", "cash")],
    );
    expect(points).toEqual([{ date: "2026-01-01", value: 1000 }]);
  });

  it("carries a balance forward inside the window when another account samples a date in between", () => {
    const points = computeNetWorthSeries(
      [
        ev("a", "2026-01-01", 100),
        ev("a", "2026-03-01", 200),
        // b's sample date falls strictly between a's two events; a has no
        // event of its own on that date, so carry-forward must supply 100
        // (the most recent a-event <= 2026-02-01), not 0 and not 200.
        ev("b", "2026-02-01", 5000),
      ],
      [acct("a", "cash"), acct("b", "cash")],
    );
    const mid = points.find((p) => p.date === "2026-02-01");
    expect(mid?.value).toBe(100 + 5000);
  });

  it("Ruling 3: a closed account contributes nothing to a later date, even with a large non-zero final balance", () => {
    // Mirrors the real scenario: a mortgage that stops reporting (paid off /
    // account closed in the source data) while still frozen at a large
    // balance, per the debt storage convention (stored = -raw, so an owed
    // $450k mortgage is stored as +450000).
    const points = computeNetWorthSeries(
      [
        ev("mortgage", "2026-01-01", 450000),
        // No further mortgage events — it closed here.
        ev("checking", "2026-01-01", 1000),
        ev("checking", "2026-06-01", 1000),
      ],
      [acct("mortgage", "loan_mortgage"), acct("checking", "cash")],
    );
    const later = points.find((p) => p.date === "2026-06-01");
    // A naive "most recent event <= D" with no upper bound would carry
    // -450000 (the mortgage's signed contribution) into this date. Correct
    // behavior: the mortgage is outside its window, contributes exactly 0,
    // so net worth here is just the checking balance.
    expect(later?.value).toBe(1000);
  });

  it("contributes zero before an account's firstDate", () => {
    const points = computeNetWorthSeries(
      [ev("late", "2026-05-01", 9999), ev("early", "2026-01-01", 100)],
      [acct("late", "cash"), acct("early", "cash")],
    );
    const first = points.find((p) => p.date === "2026-01-01");
    expect(first?.value).toBe(100); // "late" hasn't opened yet — contributes 0
  });

  it("handles an account appearing partway through the series", () => {
    const points = computeNetWorthSeries(
      [
        ev("steady", "2026-01-01", 1000),
        ev("steady", "2026-02-01", 1000),
        ev("steady", "2026-03-01", 1000),
        ev("steady", "2026-04-01", 1000),
        // "newcomer" only starts contributing from March onward.
        ev("newcomer", "2026-03-01", 500),
        ev("newcomer", "2026-04-01", 600),
      ],
      [acct("steady", "cash"), acct("newcomer", "cash")],
    );
    const byDate = new Map(points.map((p) => [p.date, p.value]));
    expect(byDate.get("2026-01-01")).toBe(1000);
    expect(byDate.get("2026-02-01")).toBe(1000);
    expect(byDate.get("2026-03-01")).toBe(1000 + 500);
    expect(byDate.get("2026-04-01")).toBe(1000 + 600);
  });

  it("subtracts a debt account's signed contribution", () => {
    const points = computeNetWorthSeries(
      [ev("cash1", "2026-01-01", 1000), ev("card", "2026-01-01", 300)],
      [acct("cash1", "cash"), acct("card", "credit_card")],
    );
    // 300 stored on a credit_card is "$300 owed" — it must subtract, not add.
    expect(points).toEqual([{ date: "2026-01-01", value: 700 }]);
  });

  it("raises net worth when a debt account closes, even with the asset side unchanged", () => {
    const points = computeNetWorthSeries(
      [
        ev("cash1", "2026-01-01", 1000),
        ev("cash1", "2026-02-01", 1000), // unchanged
        // Debt account's only event — its window is exactly this one date.
        ev("card", "2026-01-01", 500),
      ],
      [acct("cash1", "cash"), acct("card", "credit_card")],
    );
    const byDate = new Map(points.map((p) => [p.date, p.value]));
    expect(byDate.get("2026-01-01")).toBe(1000 - 500); // debt active: 500
    expect(byDate.get("2026-02-01")).toBe(1000); // debt closed: dropped, not carried
  });

  it("keeps two accounts with disjoint windows from contributing outside their own range", () => {
    const points = computeNetWorthSeries(
      [
        ev("jan", "2026-01-01", 100),
        ev("jan", "2026-01-15", 150),
        ev("mar", "2026-03-01", 900),
        ev("mar", "2026-03-15", 950),
      ],
      [acct("jan", "cash"), acct("mar", "cash")],
    );
    const byDate = new Map(points.map((p) => [p.date, p.value]));
    // Only "jan" is alive in January — "mar" hasn't opened yet.
    expect(byDate.get("2026-01-01")).toBe(100);
    expect(byDate.get("2026-01-15")).toBe(150);
    // Only "mar" is alive in March — "jan" has already closed.
    expect(byDate.get("2026-03-01")).toBe(900);
    expect(byDate.get("2026-03-15")).toBe(950);
  });

  it("returns a sorted, deduplicated union of sample dates even with overlapping and out-of-order input", () => {
    const points = computeNetWorthSeries(
      [
        // Deliberately out of chronological order, and "b" repeats a date
        // "a" already contributes on.
        ev("b", "2026-02-01", 20),
        ev("a", "2026-03-01", 30),
        ev("a", "2026-01-01", 10),
        ev("b", "2026-01-01", 15),
      ],
      [acct("a", "cash"), acct("b", "cash")],
    );
    const dates = points.map((p) => p.date);
    expect(dates).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    // Strictly ascending, no repeats.
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] > dates[i - 1]).toBe(true);
    }
  });

  it("Ruling 9: two events sharing one asOf resolve to the later recordedAt, not the first-encountered one", () => {
    const points = computeNetWorthSeries(
      [
        // Same-day double-edit: user set the balance to 100, then to 200
        // later the same day. Input order is deliberately reversed (later
        // recordedAt listed first) to prove the result depends on
        // recordedAt ordering, not array/insertion order.
        ev("a", "2026-01-01", 200, "2026-01-01T15:00:00.000Z"),
        ev("a", "2026-01-01", 100, "2026-01-01T09:00:00.000Z"),
      ],
      [acct("a", "cash")],
    );
    // Must be 200 (the later write), and there must be exactly one point for
    // this date — the two same-day events collapse to one sample, not a sum
    // (300) and not two separate points.
    expect(points).toEqual([{ date: "2026-01-01", value: 200 }]);
  });
});
